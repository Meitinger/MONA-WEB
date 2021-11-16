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
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { MonaData, MonaFileSystem, MonaRuntime } from './mona';

// @ts-ignore
global.MonacoEnvironment = { getWorkerUrl: (_moduleId: any, _label: string) => '/MONA-WEB/static/js/editor.worker.js' };

interface Contents {
    path: string
    data: string
    saved: boolean
    ran: boolean
    result: MonaData | null
    stale: boolean
}

const begin = (cb: (setter: (value: boolean) => boolean) => void) => new Promise<boolean>((resolve, _) => cb(value => {
    resolve(!value);
    return true;
}));

const end = (cb: (setter: (value: boolean) => boolean) => void) => new Promise<void>((resolve, _) => cb(value => {
    resolve();
    if (!value) {
        console.trace('Value already cleared.');
    }
    return false;
}));

const callback = async (
    contents: Contents,
    setContents: (setter: (value: Contents) => Contents) => void,
    doRun: boolean,
    saving: (setter: (value: boolean) => boolean) => void,
    running: (setter: (value: boolean) => boolean) => void,
    handleError: (message: string) => void
) => {
    const reschedule = () => setTimeout(() => callback(contents, setContents, doRun, saving, running, handleError), 500);

    if (!contents.stale && !contents.saved) {
        if (!await begin(saving)) {
            reschedule();
            return;
        }
        try {
            if (contents.stale) {
                return;
            }
            if (!contents.saved) {
                await MonaFileSystem.writeFile(contents.path, contents.data);
            }
            contents.saved = true;
        }
        catch (error) {
            handleError(`Failed to save file: ${String(error)}`);
            return;
        }
        finally {
            await end(saving);
        }
    }

    if (!contents.stale && !contents.ran && doRun) {
        if (!await begin(running)) {
            reschedule();
            return;
        }
        try {
            if (contents.stale) {
                return;
            }
            if (!contents.ran) {
                contents.result = await MonaRuntime.run(contents.path, contents.data.startsWith('MONA DFA') ? 'dfa2dot' : 'mona');
                contents.ran = true;
            }
        }
        catch (error) {
            handleError(`Failed to run file: ${String(error)}`);
            return;
        }
        finally {
            await end(running);
        }
    }

    if (!contents.stale) {
        setContents(currentContents => contents.stale ? currentContents : new Proxy(contents, {}))
    }
};

type Tab = 'Errors' | 'Graph' | 'SatisfyingExample' | 'CounterExample'

interface Context {
    id: number
    currentTab: Tab
    setCurrentTab: (tab: Tab) => void
    hasResult: boolean
    visible: boolean
}

const WorkspaceContext = createContext({} as Context);

const isCurrentTab = (context: Context, tab: Tab) => context.visible && (context.hasResult ? context.currentTab === tab : tab === 'Errors');

const viewportHeightIfTab = (context: Context, tab: Tab) => isCurrentTab(context, tab)
    ? { 'data-uk-height-viewport': `offset-top: true; offset-bottom: #tabs${context.id}` }
    : {};

const tabAttributes = (context: Context, tab: Tab) => ({
    id: `${tab.toLowerCase()}${context.id}`,
    hidden: !isCurrentTab(context, tab),
    ...viewportHeightIfTab(context, tab)
});

const TextArea = ({ tab, values }: {
    tab: Tab
    values: string[] | undefined
}) => {
    const context = useContext(WorkspaceContext);
    return (
        <textarea {...tabAttributes(context, tab)} className="uk-textarea uk-width-1-1" style={{ fontFamily: 'monospace' }} readOnly={true} value={values?.join('\n') ?? ''} />
    );
};

const Link = ({ tab, children }: {
    tab: Tab
    children: string
}) => {
    const context = useContext(WorkspaceContext);
    return (
        <li className={isCurrentTab(context, tab) ? 'uk-active' : tab !== 'Errors' && !context.hasResult ? 'uk-disabled' : ''}>
            <a href={`#${tab.toLowerCase()}${context.id}`} onClick={e => { context.setCurrentTab(tab); e.preventDefault(); }}>{children}</a>
        </li>
    );
};

export const Workspace = ({ id, path, readOnly, selected }: {
    id: number
    path: string
    readOnly: boolean
    selected: boolean
}) => {
    const editorDiv = useRef<HTMLDivElement>(null);
    const graphDiv = useRef<HTMLDivElement>(null);
    const [errors, setErrors] = useState<string[]>([]);
    const [currentTab, setCurrentTab] = useState<Tab>('Graph');
    const [contents, setContents] = useState<Contents>({ path, data: '', saved: true, ran: true, result: null, stale: false });
    const [autoSave, setAutoSave] = useState(true);
    const [autoRun, setAutoRun] = useState(true);
    const [saving, setSaving] = useState(false);
    const [running, setRunning] = useState(false);
    const [scale, setScale] = useState(1);

    const context = useMemo<Context>(() => ({
        id,
        currentTab,
        setCurrentTab,
        hasResult: !!contents.result,
        visible: selected
    }), [id, currentTab, contents, selected]);

    const appendError = (message: string) => {
        setErrors(errors => errors.concat([message]));
    };

    const callbackWrapper = (doRun: boolean) => callback(contents, setContents, doRun, setSaving, setRunning, appendError);

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
        if ((!autoSave || contents.saved) && (!autoRun || contents.result)) {
            return;
        }
        const timeout = setTimeout(() => callback(contents, setContents, autoRun, setSaving, setRunning, appendError), 500);
        return () => clearTimeout(timeout);
    }, [contents, autoSave, autoRun]);

    useEffect(() => {
        const div = graphDiv.current;
        if (!div) {
            appendError('Graph DIV not found.');
            return;
        }
        const graph = contents.result?.dfa?.graph;
        if (!graph) {
            return;
        }
        try {
            let element = new DOMParser().parseFromString(graph, 'image/svg+xml').documentElement;
            if (element.nodeName !== 'svg') {
                element = document.createElement('div');
                element.innerText = graph;
            }
            element.style.transformOrigin = 'top left';
            element.style.transform = `scale(${scale})`;
            div.appendChild(element);
            return () => { div.removeChild(element); }
        }
        catch (error) {
            appendError(`Cannot render file: ${String(error)}`);
            return;
        }
    }, [contents, scale]);

    useEffect(() => {
        if (!editorDiv.current) {
            appendError('Editor DIV not found.');
            return;
        }
        const editor = monaco.editor.create(editorDiv.current, {
            readOnly,
            automaticLayout: true
        });
        editor.onDidChangeModelContent(e => {
            const data = editor.getValue();
            setContents(contents => {
                if (contents.data === data) {
                    return contents;
                }
                contents.stale = true;
                return {
                    path,
                    data,
                    saved: e.isFlush,
                    ran: data.length === 0,
                    result: null,
                    stale: false,
                }
            });
            setErrors([]);
        });

        let isFirstSet = true;
        const setContentsAndClose = (contents: string | null) => {
            if (contents != null && (readOnly || isFirstSet)) {
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
    }, [path, readOnly]);

    return (
        <div className="uk-grid-divider uk-grid-small uk-flex-nowrap" data-uk-grid>
            <div className="uk-width-1-2">
                <div ref={editorDiv} {...selected && { 'data-uk-height-viewport': "offset-top: true; offset-bottom: true" }}></div>
                <nav className="uk-flex uk-flex-bottom uk-navbar-container" data-uk-navbar>
                    <div className="uk-navbar-left">
                        <div className="uk-navbar-item">
                            <button className="uk-button uk-button-default" disabled={contents.saved || saving} title="Save File" onClick={() => callbackWrapper(false)}><span data-uk-icon="database"></span></button>
                            <label><input type="checkbox" className="uk-checkbox" checked={autoSave} onChange={e => setAutoSave(e.target.checked)} /> Auto-Save</label>
                            <div data-uk-spinner style={{ visibility: saving ? 'visible' : 'hidden' }}></div>
                        </div>
                        <div className="uk-navbar-item">
                            <button className={`uk-button uk-button-${running ? 'danger' : 'primary'}`} disabled={contents.ran} title={running ? 'Abort Run' : 'Run File'} onClick={() => running ? MonaRuntime.stop('Cancelled by user.') : callbackWrapper(true)}><span data-uk-icon={running ? 'bolt' : 'play'}></span></button>
                            <label><input type="checkbox" className="uk-checkbox" checked={autoRun} onChange={e => setAutoRun(e.target.checked)} /> Auto-Run</label>
                            <div data-uk-spinner style={{ visibility: running ? 'visible' : 'hidden' }}></div>
                        </div>
                    </div>
                </nav>
            </div>
            <div className="uk-width-1-2">
                <WorkspaceContext.Provider value={context}>
                    <TextArea tab="Errors" values={errors} />
                    <div {...tabAttributes(context, 'Graph')}>
                        <div className="uk-margin">
                            <input className="uk-range" type="range" min="1" max="10" step="0.1" value={scale} onChange={e => setScale(parseFloat(e.target.value))} />
                        </div>
                        <div className="uk-panel uk-panel-scrollable" {...viewportHeightIfTab(context, 'Graph')}>
                            <div ref={graphDiv}></div>
                        </div>
                    </div>
                    <TextArea tab="SatisfyingExample" values={contents.result?.satisfyingExample} />
                    <TextArea tab="CounterExample" values={contents.result?.counterExample} />
                    <div id={`tabs${context.id}`}>
                        <ul className="uk-tab-bottom uk-margin-remove-bottom uk-tab">
                            <Link tab="Errors">Errors</Link>
                            <Link tab="Graph">Graph</Link>
                            <Link tab="SatisfyingExample">Satisfying Example</Link>
                            <Link tab="CounterExample">Counter-Example</Link>
                        </ul>
                    </div>
                </WorkspaceContext.Provider>
            </div>
        </div>
    );
};
