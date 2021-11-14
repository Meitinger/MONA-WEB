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

import { createContext, useMemo, useState } from 'react';
import { render } from 'react-dom';
import { Browser } from './browser';
import { Tab, TabsHandler, Tabs } from './tabs';
import './uikitloader.js';
import { Workspace } from './workspace';

export const AppContext = createContext({} as {
    openTab: (path: string, readOnly: boolean) => void
    closeTab: (path: string) => void
});

const App = () => {
    const [tabs, setTabs] = useState<Tabs>({});
    const tabHandler = useMemo(() => new TabsHandler(setTabs), []);

    return (
        <AppContext.Provider value={tabHandler}>
            <nav className="uk-navbar-container uk-navbar-transparent uk-light uk-background-primary" data-uk-navbar>
                <div className="uk-navbar-left">
                    <a className="uk-navbar-item uk-logo" href="https://www.brics.dk/mona/">MONA Web</a>
                </div>
                <div className="uk-navbar-right">
                    <div className="uk-navbar-item">
                        <a className="uk-button uk-button-default" href="http://www.brics.dk/mona/mona14.pdf">Manual</a>
                    </div>
                </div>
            </nav>
            <div className="uk-grid-divider uk-grid-small uk-flex-nowrap" data-uk-grid data-uk-height-viewport="offset-top: true">
                <div className="uk-width-medium">
                    <ul className="uk-flex-center" data-uk-tab>
                        <li className="uk-active"><a href="#browser"><span uk-icon="icon: copy"></span><span className="uk-margin-small-left" style={{ textTransform: 'none' }}>Files</span></a></li>
                    </ul>
                    <div id="browser">
                        <Browser />
                    </div>
                </div>
                <div className="uk-width-extend">
                    <ul data-uk-tab>
                        {Object.entries(tabs).map(([path, tab], index) => <Tab key={path} id={`#workspace${index}`} path={path} selected={tab.selected} readOnly={tab.readOnly} />)}
                    </ul>
                    <div className="uk-margin">
                        {Object.entries(tabs).map(([path, tab], index) => <div key={path} id={`workspace${index}`} hidden={!tab.selected}><Workspace id={index} path={path} readOnly={tab.readOnly} /></div>)}
                    </div>
                </div>
            </div>
        </AppContext.Provider>
    );
};

render(<App />, document.getElementById('app'));
