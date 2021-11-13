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

import * as monaco from 'monaco-editor';
import { useContext, useEffect, useRef, useState } from 'react';
import { render } from 'react-dom';
import { AppContext } from '.';
import { alert } from './helpers';
import { MonaData, MonaFileSystem, MonaRuntime } from './mona';

// @ts-ignore
global.MonacoEnvironment = { getWorkerUrl: (_moduleId: any, _label: string) => '/MONA-WEB/static/js/editor.worker.js' };

interface Contents {
    path: string
    data: string | null
    saved: boolean
    result: MonaData | null
    stale: boolean
}

function begin(cb: (setter: (value: boolean) => boolean) => void): Promise<boolean> {
    return new Promise<boolean>((resolve, _) => cb(value => {
        resolve(!value);
        return true;
    }));
}

function end(cb: (setter: (value: boolean) => boolean) => void): Promise<void> {
    return new Promise<void>((resolve, _) => cb(value => {
        resolve();
        if (!value) {
            console.trace('Value already cleared.');
        }
        return false;
    }));
}

export const Workspace = ({ path, readonly }: { path: string, readonly: boolean }) => {
    const app = useContext(AppContext);
    const editorDiv = useRef<HTMLDivElement>(null);
    const errorsDiv = useRef<HTMLDivElement>(null);
    const graphDiv = useRef<HTMLDivElement>(null);
    const [contents, setContents] = useState<Contents>({ path, data: null, saved: true, result: null, stale: false });
    const [autoSave, setAutoSave] = useState(true);
    const [autoRun, setAutoRun] = useState(true);
    const [saving, setSaving] = useState(false);
    const [running, setRunning] = useState(false);

    const appendError = (message: string) => {
        if (!editorDiv.current) {
            alert(message);
            return;
        }
        render(
            (
                <div className="uk-alert-danger" data-uk-alert>
                    <button className="uk-alert-close" data-uk-close></button>
                    <p>{message}</p>
                </div>
            ),
            editorDiv.current.appendChild(editorDiv.current.ownerDocument.createElement('div'))
        );
    };

    const callback = async (doRun: boolean) => {
        const updateIfNotStale = () => {
            if (!contents.stale) {
                setContents({ ...contents });
            }
        };
        const reschedule = () => setTimeout(() => callback(doRun), 1000);

        if (!contents.saved) {
            if (!await begin(setSaving)) {
                reschedule();
                return;
            }
            try {
                if (!contents.stale) {
                    if (contents.data) {
                        await MonaFileSystem.writeFile(contents.path, contents.data);
                    }
                    contents.saved = true;
                }
            }
            catch (error) {
                appendError(`Failed to save file: ${String(error)}`);
                return;
            }
            finally {
                await end(setSaving);
            }
            updateIfNotStale();
        }

        if (!contents.result && doRun) {
            if (!await begin(setRunning)) {
                reschedule();
                return;
            }
            try {
                if (!contents.stale) {
                    contents.result = await MonaRuntime.run(contents.path);
                }
            }
            catch (error) {
                appendError(`Failed to run file: ${String(error)}`);
                return;
            }
            finally {
                await end(setRunning);
            }
            updateIfNotStale();
        }
    };

    useEffect(() => {
        if (!autoSave) {
            setAutoRun(false);
        }
    }, [autoSave]);

    useEffect(() => {
        if (autoRun) {
            setAutoSave(true);
        }
    }, [autoRun]);

    useEffect(() => {
        if (!autoSave && !autoRun) {
            return;
        }
        const timeout = setTimeout(() => callback(autoRun), 1000);
        return () => clearTimeout(timeout);
    }, [contents, autoSave, autoRun]);

    useEffect(() => {
        const div = graphDiv.current;
        if (!div) {
            return;
        }
        const graph = contents.result?.dfa?.graph;
        if (!graph) {
            return;
        }
        try {
            const element = new DOMParser().parseFromString(graph, 'image/svg+xml').documentElement;
            div.appendChild(element);
            return () => { div.removeChild(element); }
        }
        catch (error) {
            appendError(`Cannot render file: ${String(error)}`);
            return;
        }
    }, [contents]);

    useEffect(() => {
        if (!editorDiv.current) {
            throw new Error('Editor DIV not found.');
        }
        const editor = monaco.editor.create(editorDiv.current, { readOnly: readonly });
        if (!readonly) {
            editor.onDidChangeModelContent(e => {
                setContents(contents => {
                    contents.stale = true;
                    return {
                        path,
                        data: editor.getValue(),
                        saved: e.isFlush,
                        result: null,
                        stale: false,
                    }
                });
            });
        }



        let isFirstSet = true;
        const setContentsAndClose = (contents: string | null) => {
            if (contents == null) {
                app.closeTab(path);
                return;
            }
            if (readonly || isFirstSet) {
                isFirstSet = false;
                const view = editor.saveViewState();
                editor.setValue(contents);
                if (view) {
                    editor.restoreViewState(view);
                }
            }
        };
        MonaFileSystem.addFileListener(path, setContentsAndClose);
        MonaFileSystem.readFile(path)
            .then(setContentsAndClose)
            .catch(reason => appendError(`Failed to read file: ${String(reason)}`));

        return () => {
            MonaFileSystem.removeFileListener(path, setContentsAndClose);
            editor.dispose();
        }
    }, [app, path, readonly]);

    return (
        <div className="uk-grid-divider uk-grid-small" data-uk-grid>
            <div className="uk-width-1-2">
                <div ref={errorsDiv}></div>
                <div ref={editorDiv} className="uk-width-1-1 uk-height-large"></div>
                <nav className="uk-navbar-container" data-uk-navbar>
                    <div className="uk-navbar-left">
                        <div className="uk-navbar-item">
                            <button className="uk-button uk-button-default" disabled={contents.saved || saving} title="Save File" onClick={() => callback(false)}><span data-uk-icon="database"></span></button>
                            <label><input type="checkbox" className="uk-checkbox" checked={autoSave} onChange={e => setAutoSave(e.target.checked)} /> Auto Save</label>
                            <div data-uk-spinner style={{ visibility: saving ? 'visible' : 'hidden' }}></div>
                        </div>
                        <div className="uk-navbar-item">
                            <button className={`uk-button uk-button-${running ? 'danger' : 'primary'}`} disabled={!!contents.result} title={running ? 'Abort Run' : 'Run File'} onClick={() => running ? MonaRuntime.stop('Cancelled by user.') : callback(true)}><span data-uk-icon={running ? 'bolt' : 'play'}></span></button>
                            <label><input type="checkbox" className="uk-checkbox" checked={autoRun} onChange={e => setAutoRun(e.target.checked)} /> Auto Save</label>
                            <div data-uk-spinner style={{ visibility: running ? 'visible' : 'hidden' }}></div>
                        </div>
                    </div>
                </nav>
            </div>
            <div className="uk-width-1-2">
                <div ref={graphDiv}></div>
            </div>
        </div >
    );
};
