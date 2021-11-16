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

import { useContext, useEffect, useState } from 'react';
import { AppContext } from '.';
import { MonaFileSystem } from './mona';

export interface Tabs {
    [path: string]: {
        readOnly: boolean
        selected: boolean
    }
}

export class TabsHandler {
    constructor(private setTabs: (setter: (value: Tabs) => Tabs) => void) { }

    openTab(path: string, readOnly: boolean): void {
        this.setTabs(tabs => ({
            ...Object.fromEntries(Object.entries(tabs).map(([path, tab]) => [path, { ...tab, selected: false }])),
            [path]: { readOnly, selected: true }
        }));
    }

    closeTab(path: string): void {
        this.setTabs(tabs => {
            const tab = tabs[path];
            if (tab) {
                const newTabs = { ...tabs };
                delete newTabs[path];
                if (tab.selected) {
                    const keys = Object.keys(tabs);
                    const index = keys.indexOf(path);
                    const selectedPath = (index + 1) < keys.length ? keys[index + 1] : (index - 1) >= 0 ? keys[index - 1] : undefined;
                    if (selectedPath !== undefined) {
                        const selectedTab = newTabs[selectedPath];
                        if (selectedTab) {
                            newTabs[selectedPath] = { ...selectedTab, selected: true };
                        }
                    }
                }
                return newTabs;
            }
            else {
                return tabs;
            }
        });
    }
}

export const Tab = ({ id, path, selected, readOnly }: {
    id: string
    path: string
    selected: boolean
    readOnly: boolean
}) => {
    const app = useContext(AppContext);
    const [deleted, setDeleted] = useState(false);

    useEffect(() => {
        const listener = (contents: string | null) => setDeleted(contents == null);
        MonaFileSystem.addFileListener(path, listener);
        MonaFileSystem.isFile(path).then(isFile => setDeleted(!isFile)).catch(console.trace);
        return () => MonaFileSystem.removeFileListener(path, listener);
    }, [app, path]);

    return (
        <li className={selected ? 'uk-active' : ''}>
            <a href={id} onClick={e => { app.openTab(path, readOnly); e.preventDefault(); }}>
                <span uk-icon="icon: file-text"></span>
                <span className="uk-margin-small-left uk-margin-small-right" style={{ textTransform: 'none' }}>{path}{readOnly && ' (read-only)'}{deleted && ' (deleted)'}</span>
                <button data-uk-close onClick={e => { app.closeTab(path); e.stopPropagation(); e.preventDefault(); }}>
                </button>
            </a>
        </li>
    );
};
