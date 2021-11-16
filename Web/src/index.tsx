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

import { createContext, useEffect, useMemo, useReducer } from 'react';
import { render } from 'react-dom';
import { Browser } from './browser';
import { MonaFileSystem, MonaInputPath, MonaOutputPath } from './mona';
import { Tab, TabsHandler, Tabs } from './tabs';
import './uikitloader.js';
import { Workspace } from './workspace';

export const AppContext = createContext({} as {
    openTab: (path: string, readOnly: boolean) => void
    closeTab: (path: string) => void
});

const createSampleOnFirstRun = async (setTabs: (setter: (value: Tabs) => Tabs) => void) => {
    const isDirectoryEmpty = async (path: string) => {
        const contents = await MonaFileSystem.enumDirectory(path);
        return contents.directories.length === 0 && contents.files.length === 0;
    };

    if (await isDirectoryEmpty(MonaInputPath) && await isDirectoryEmpty(MonaOutputPath)) {
        const exampleFileName = `${MonaInputPath}/example`;
        await MonaFileSystem.writeFile(exampleFileName, '# As an example, you could try:\nvar2 P,Q;\nP\\Q = {0,4} union {1,2};\n');
        setTabs(_ => ({ [exampleFileName]: { selected: true, readOnly: false } }));
    }
};

const App = () => {
    const [tabs, setTabs] = useReducer((tabs: Tabs, action: (tabs: Tabs) => Tabs) => {
        const result = action(tabs);
        window.localStorage.setItem('tabs', JSON.stringify(result));
        return result;
    }, JSON.parse(window.localStorage.getItem('tabs') ?? '{}') as Tabs);
    const tabHandler = useMemo(() => new TabsHandler(setTabs), []);

    useEffect(() => {
        createSampleOnFirstRun(setTabs);
    }, []);

    return (
        <AppContext.Provider value={tabHandler}>
            <nav className="uk-navbar-container uk-navbar-transparent uk-light uk-background-primary" data-uk-navbar>
                <div className="uk-navbar-left">
                    <a className="uk-navbar-item uk-logo" target="_blank" rel="noreferrer" href="https://www.brics.dk/mona/">MONA Web</a>
                </div>
                <div className="uk-navbar-right">
                    <div className="uk-navbar-item">
                        <a className="uk-button uk-button-default" target="_blank" rel="noreferrer" href="http://www.brics.dk/mona/mona14.pdf">Manual</a>
                    </div>
                </div>
            </nav>
            <div className="uk-grid-divider uk-grid-small uk-flex-nowrap" data-uk-grid data-uk-height-viewport="offset-top: true">
                <div className="uk-width-medium">
                    <ul className="uk-flex-center uk-tab">
                        <li className="uk-active"><a href="#browser" onClick={e => e.preventDefault()}><span uk-icon="icon: copy"></span><span className="uk-margin-small-left" style={{ textTransform: 'none' }}>Files</span></a></li>
                    </ul>
                    <div id="browser">
                        <Browser />
                    </div>
                </div>
                <div className="uk-width-extend">
                    <ul className="uk-tab">
                        {Object.entries(tabs).map(([path, tab], index) => <Tab key={path} id={`#workspace${index}`} path={path} selected={tab.selected} readOnly={tab.readOnly} />)}
                    </ul>
                    <div className="uk-margin">
                        {Object.entries(tabs).map(([path, tab], index) => <div key={path} id={`workspace${index}`} hidden={!tab.selected}><Workspace id={index} path={path} {...tab} /></div>)}
                    </div>
                </div>
            </div>
        </AppContext.Provider>
    );
};

render(<App />, document.getElementById('app'));
