/*
 * MONA-WEB
 * Copyright (C) 2021 Manuel Meitinger.
 *
 * MONA
 * Copyright (C) 1997-2013 Aarhus University.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the  Free Software
 * Foundation, Inc., 51 Franklin Street, Suite 500, Boston, MA 02110-1335,
 * USA.
 */

export const MonaInputPath = '/input';
export const MonaOutputPath = '/output';

export interface MonaDirectoryContents {
    directories: string[]
    files: string[]
}

interface Node {
    mode: number
    contents: {
        [name: string]: Node
    }
}

interface FileSystem {
    pull: () => Promise<void>
    read: (path: string) => string
    write: (path: string, data: string) => Promise<void>
    unlink: (path: string) => Promise<void>
    mkdir: (path: string) => Promise<void>
    rmdir: (path: string) => Promise<void>
    node: (path: string) => Node
    tryNode: (path: string) => Node | null
    isFile: (node: Node) => boolean
    isDirectory: (node: Node) => boolean
}

export type MonaFileListener = (contents: string | null) => void

export type MonaDirectoryListener = (contents: MonaDirectoryContents) => void

export class MonaFileSystem {
    private static readonly _fs = this.buildFileSystem();
    private static readonly _fileListeners = new Map<string, Set<MonaFileListener>>();
    private static readonly _directoryListeners = new Map<string, Set<MonaDirectoryListener>>();

    private static async buildFileSystem(): Promise<FileSystem> {
        // any-thing goes in this method, so be careful
        const module = await (global as any).MonaModule();
        const fs = module.FS;
        fs.mkdir(MonaInputPath);
        fs.mkdir(MonaOutputPath);
        const inputMount = fs.mount(module.IDBFS, {}, MonaInputPath);
        const outputMount = fs.mount(module.IDBFS, {}, MonaOutputPath);
        await new Promise<void>((resolve, reject) => fs.syncfs(true, (error: any) => error ? reject(error) : resolve()));
        const modify = async (path: string, op: (path: string) => void) => {
            const isOutput = this.isOutputPath(path);
            if (isOutput && !MonaRuntime.isIdle) {
                throw new Error(`Operation on path '${path}' can only be initiated once all pending MONA tasks have finished.`);
            }
            op(path);
            await new Promise<void>((resolve, reject) => module.IDBFS.syncfs(isOutput ? outputMount.mount : inputMount.mount, false, (error: any) => error ? reject(error) : resolve()));
        };
        return {
            pull: () => new Promise<void>((resolve, reject) => module.IDBFS.syncfs(outputMount.mount, true, (error: any) => error ? reject(error) : resolve())),
            read: (path) => fs.readFile(path, { encoding: 'utf8' }),
            write: (path, data) => modify(path, path => fs.writeFile(path, data)),
            unlink: (path) => modify(path, path => fs.unlink(path)),
            mkdir: (path) => modify(path, path => fs.mkdir(path)),
            rmdir: (path) => modify(path, path => fs.rmdir(path)),
            node: (path) => fs.lookupPath(path, { follow: true }).node,
            tryNode: (path) => fs.analyzePath(path, false).object,
            isFile: (node) => fs.isFile(node.mode),
            isDirectory: (node) => fs.isDir(node.mode),
        };
    }

    private static isOutputPath(path: string): boolean {
        return path.startsWith(MonaOutputPath) && (path.length === MonaOutputPath.length || path[MonaOutputPath.length] === '/');
    }

    static async refresh(): Promise<void> {
        const fs = await this._fs;
        await fs.pull();
        for (const [path, listeners] of this._fileListeners) {
            if (this.isOutputPath(path)) {
                const node = fs.tryNode(path);
                this.notifyListenersDirect(listeners, node && fs.isFile(node) ? fs.read(path) : null);
            }
        }
        for (const [path, listeners] of this._directoryListeners) {
            if (this.isOutputPath(path)) {
                const node = fs.tryNode(path);
                if (node && fs.isDirectory(node)) {
                    this.notifyListenersDirect(listeners, this.getDirectoryContents(fs, path));
                }
            }
        }
    }

    private static ensureNotExists(fs: FileSystem, path: string): void {
        if (fs.tryNode(path)) {
            throw new Error(`A node at path '${path}' already exists.`)
        }
    }

    //
    //  Files
    //

    static async isFile(path: string): Promise<boolean> {
        const fs = await this._fs;
        const node = fs.tryNode(path);
        return !!node && fs.isFile(node);
    }

    static async createFile(path: string): Promise<void> {
        const fs = await this._fs;
        this.ensureNotExists(fs, path);
        await fs.write(path, '');
        this.notifyFileListeners(path, '');
        this.notifyParentDirectoryListeners(fs, path);
    }

    static async readFile(path: string): Promise<string> {
        const fs = await this._fs;
        return fs.read(path);
    }

    static async writeFile(path: string, contents: string): Promise<void> {
        const fs = await this._fs;
        const created = fs.tryNode(path) == null;
        await fs.write(path, contents);
        this.notifyFileListeners(path, contents);
        if (created) {
            this.notifyParentDirectoryListeners(fs, path);
        }
    }

    static async deleteFile(path: string): Promise<void> {
        const fs = await this._fs;
        await fs.unlink(path);
        this.notifyFileListeners(path, null);
        this.notifyParentDirectoryListeners(fs, path);
    }

    static addFileListener(path: string, listener: MonaFileListener): void {
        this.addListener(this._fileListeners, path, listener);
    }

    static removeFileListener(path: string, listener: MonaFileListener): void {
        this.removeListener(this._fileListeners, path, listener);
    }

    private static notifyFileListeners(path: string, contents: string | null): void {
        this.notifyListeners(this._fileListeners, path, contents);
    }

    //
    // Directories
    //

    private static getDirectoryContents(fs: FileSystem, path: string): MonaDirectoryContents {
        const entries = Object.entries(fs.node(path).contents);
        const filter = (predicate: (node: Node) => boolean): string[] => entries.filter(([_, node]) => predicate(node)).map(([name, _]) => name).sort();
        return {
            directories: filter(node => fs.isDirectory(node)),
            files: filter(node => fs.isFile(node)),
        };
    }

    static async isDirectory(path: string): Promise<boolean> {
        const fs = await this._fs;
        const node = fs.tryNode(path);
        return !!node && fs.isDirectory(node);
    }

    static async createDirectory(path: string): Promise<void> {
        const fs = await this._fs;
        this.ensureNotExists(fs, path);
        await fs.mkdir(path);
        this.notifyDirectoryListeners(path, { directories: [], files: [] });
        this.notifyParentDirectoryListeners(fs, path);
    }

    static async enumDirectory(path: string): Promise<MonaDirectoryContents> {
        const fs = await this._fs;
        return this.getDirectoryContents(fs, path);
    }

    static async deleteDirectory(path: string): Promise<void> {
        const fs = await this._fs;
        await fs.rmdir(path);
        this.notifyParentDirectoryListeners(fs, path);
    }

    static addDirectoryListener(path: string, listener: MonaDirectoryListener): void {
        this.addListener(this._directoryListeners, path, listener);
    }

    static removeDirectoryListener(path: string, listener: MonaDirectoryListener): void {
        this.removeListener(this._directoryListeners, path, listener);
    }

    private static notifyDirectoryListeners(path: string, contents: MonaDirectoryContents): void {
        this.notifyListeners(this._directoryListeners, path, contents);
    }

    private static notifyParentDirectoryListeners(fs: FileSystem, path: string): void {
        const lastSeparator = path.lastIndexOf('/');
        if (lastSeparator > -1) {
            path = path.substring(0, lastSeparator);
            this.notifyDirectoryListeners(path, this.getDirectoryContents(fs, path));
        }
    }

    //
    // Listeners
    //

    private static addListener<T>(listeners: Map<string, Set<T>>, path: string, listener: T): void {
        const listenersForPath = listeners.get(path);
        if (listenersForPath) {
            listenersForPath.add(listener);
        }
        else {
            listeners.set(path, new Set([listener]));
        }
    }

    private static removeListener<T>(listeners: Map<string, Set<T>>, path: string, listener: T): void {
        const listenersForPath = listeners.get(path);
        if (listenersForPath && listenersForPath.delete(listener) && listenersForPath.size === 0) {
            listeners.delete(path);
        }
    }

    private static notifyListeners<T>(listeners: Map<string, Set<(contents: T) => void>>, path: string, contents: T): void {
        const listenersDirect = listeners.get(path);
        if (listenersDirect) {
            this.notifyListenersDirect(listenersDirect, contents);
        };
    }

    private static notifyListenersDirect<T>(listeners: Set<(contents: T) => void>, contents: T): void {
        listeners.forEach(listener => {
            try { listener(contents); }
            catch (error) { console.trace(error); }
        });
    }
}

export interface MonaData {
    id: number
    dfa?: {
        freeVariables?: string[]
        transitions?: {
            [from: string]: {
                [input: string]: string[]
            }
        }
        initialState?: string
        acceptingStates?: string[]
        rejectingStates?: string[]
        dontCareStates?: string[]
        graph: string
    }
    counterExample?: string[]
    satisfyingExample?: string[]
    timings?: {
        [label: string]: number
    }
}

export type MonaRunListener = (isRunning: boolean) => void

interface Task {
    resolve: (value: MonaData | PromiseLike<MonaData>) => void
    reject: (reason: any) => void
}

export class MonaRuntime {
    private static _worker = this.createWorker();
    private static readonly _tasks = new Map<number, Task>();
    private static readonly _runListeners = new Set<MonaRunListener>()
    private static _nextId = 0;

    private static createWorker(): Worker {
        const worker = new Worker('/MONA-WEB/static/js/worker.js', { name: 'Mona' });
        worker.onerror = e => this.stop(`Error in worker: ${e.message} (${e.lineno}:${e.colno})`);
        worker.onmessageerror = e => this.finishTask(e.data.id, task => task.reject('Failed to deserialize worker message.'));
        worker.onmessage = e => this.finishTask(e.data.id, task => {
            MonaFileSystem.refresh().catch(error => console.trace(error));
            if (e.data.error) {
                task.reject(e.data.error);
            }
            else {
                task.resolve(e.data);
            }
        });
        return worker;
    }

    private static destroyWorker(worker: Worker): void {
        worker.terminate();
        worker.onerror = null;
        worker.onmessageerror = null;
        worker.onmessage = null;
    }

    private static finishTask(id: number, cb: (task: Task) => void): void {
        const task = this._tasks.get(id);
        if (task) {
            console.assert(this._tasks.delete(id));
            if (this._tasks.size === 0) {
                this.notifyRunListeners(false);
            }
            try { cb(task); }
            catch (error) { console.trace(error); }
        }
    }

    private static notifyRunListeners(isRunning: boolean): void {
        this._runListeners.forEach(runListener => {
            try { runListener(isRunning); }
            catch (error) { console.trace(error); }
        });
    }

    static addRunListener(listener: MonaRunListener): void {
        this._runListeners.add(listener);
    }

    static removeRunListener(listener: MonaRunListener): void {
        this._runListeners.delete(listener);
    }

    static get isIdle(): boolean {
        return this._tasks.size === 0;
    }

    static run(path: string, module: 'mona' | 'dfa2dot' | 'gta2dot'): Promise<MonaData> {
        return new Promise<MonaData>((resolve, reject) => {
            const id = ++this._nextId;
            this._tasks.set(id, { resolve, reject });
            if (this._tasks.size === 1) {
                this.notifyRunListeners(true);
            }
            try { this._worker.postMessage({ id, path, module }); }
            catch (error) { this.finishTask(id, task => task.reject(error)); }
        });
    }

    static stop(reason: any): void {
        const worker = this._worker;
        this._worker = this.createWorker();
        this.destroyWorker(worker);
        const tasks = [...this._tasks.values()];
        this._tasks.clear();
        this.notifyRunListeners(false);
        tasks.forEach(task => {
            try { task.reject(reason); }
            catch (error) { console.trace(error); }
        });
    }
}
