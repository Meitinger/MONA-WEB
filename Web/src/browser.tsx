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

import { useContext, useEffect, useReducer, useState } from 'react';
import { AppContext } from '.';
import { alert, confirm } from './helpers';
import { MonaDirectoryContents, MonaFileSystem, MonaInputPath, MonaOutputPath } from './mona';

const isInvalidName = (name: string) => name.length === 0 || name.includes('/');

const getName = (path: string) => path.substring(path.lastIndexOf('/') + 1);

const File = ({ path, isOutput }: {
    path: string
    isOutput: boolean
}) => {
    const app = useContext(AppContext);
    const name = getName(path);

    const openFile = () => app.openTab(path, isOutput);

    const deleteFile = async () => {
        if (await confirm(`Are you sure you want to delete the file '${path}'?`)) {
            try { await MonaFileSystem.deleteFile(path); }
            catch (error) { await alert(String(error)); }
        }
    };

    return (
        <div className="uk-flex">
            <div className="uk-width-auto">
                <div className="uk-icon-image"></div>
            </div>
            <div className="uk-width-expand">
                <button className="uk-width-1-1 uk-text-left uk-button uk-button-small uk-button-default" style={{ textTransform: 'none' }} title="Open File" onClick={openFile}>
                    <span data-uk-icon="file-text"></span> {name}
                </button>
            </div>
            <div className="uk-width-auto">
                <button className="uk-button uk-button-small uk-button-danger uk-padding-remove" title="Delete File" onClick={deleteFile}>
                    <span data-uk-icon="close"></span>
                </button>
            </div>
        </div>
    );
}

const Directory = ({ path, isOutput, isRoot }: {
    path: string
    isOutput: boolean
    isRoot: boolean
}) => {
    const app = useContext(AppContext);
    const [contents, setContents] = useState<MonaDirectoryContents | null | Error>(null);
    const [expanded, toggleExpanded] = useReducer((state: boolean) => {
        state = !state;
        window.localStorage.setItem(`expand${path}`, JSON.stringify(state));
        return state;
    }, JSON.parse(window.localStorage.getItem(`expand${path}`) ?? 'true') as boolean);
    const [newChildName, setNewChildName] = useState<string>('');

    const name = getName(path);

    useEffect(() => {
        MonaFileSystem.addDirectoryListener(path, setContents);
        MonaFileSystem.enumDirectory(path).then(setContents).catch(reason => setContents(new Error(String(reason))));
        return () => MonaFileSystem.removeDirectoryListener(path, setContents);
    }, [path]);


    const createFile = async () => {
        const childPath = `${path}/${newChildName}`;
        try { await MonaFileSystem.createFile(childPath); }
        catch (error) { return await alert(String(error)); }
        setNewChildName('');
        app.openTab(childPath, isOutput);
    }

    const createDirectory = async () => {
        try { await MonaFileSystem.createDirectory(`${path}/${newChildName}`); }
        catch (error) { return await alert(String(error)); }
        setNewChildName('');
    }

    const deleteDirectory = async () => {
        if (contents && !(contents instanceof Error) && (contents.directories.length > 0 || contents.files.length > 0)) {
            await alert(`The directory '${path}' is not empty.`);
        }
        else if (await confirm(`Are you sure you want to delete the folder '${path}'?`)) {
            try { await MonaFileSystem.deleteDirectory(path); }
            catch (error) { await alert(String(error)); }
        }
    };

    return (
        <div className="uk-flex">
            <div className="uk-width-auto">
                <div className="uk-icon-image">
                    {contents && <span data-uk-icon={expanded ? 'chevron-down' : 'chevron-right'} style={{ cursor: 'pointer' }} onClick={toggleExpanded}></span>}
                </div>
            </div>
            <div className="uk-width-expand">
                <div className="uk-flex">
                    <div className="uk-width-expand">
                        <button className={`uk-width-1-1 uk-text-left uk-button uk-button-small uk-button-${isRoot ? 'primary' : 'secondary'}`} title={`${contents ? (expanded ? 'Collapse' : 'Expand') : 'Loading'} Folder`} style={{ textTransform: 'none' }} onClick={toggleExpanded} disabled={!contents}>
                            <span data-uk-icon="folder"></span><span className="uk-margin-small-left uk-margin-small-right">{name}</span>{!contents && <div data-uk-spinner="ratio: 0.5"></div>}
                        </button>
                    </div>
                    <div className="uk-width-auto">
                        {isRoot ||
                            <button className="uk-button uk-button-small uk-button-danger uk-padding-remove" title="Delete Folder" onClick={deleteDirectory}>
                                <span data-uk-icon="close"></span>
                            </button>
                        }
                    </div>
                </div>
                {contents && expanded && (contents instanceof Error ?
                    <div className="uk-alert-danger">
                        <p>{contents}</p>
                    </div>
                    :
                    <>
                        {contents.directories.map(childName => <Directory key={childName} path={`${path}/${childName}`} isOutput={isOutput} isRoot={false} />)}
                        {contents.files.map(childName => <File key={childName} path={`${path}/${childName}`} isOutput={isOutput} />)}
                        <div className="uk-flex">
                            <div className="uk-width-auto">
                                <div className="uk-icon-image"></div>
                            </div>
                            <div className="uk-width-expand">
                                <div className="uk-inline">
                                    <span className="uk-form-icon" data-uk-icon="plus"></span>
                                    <input className="uk-input uk-form-small uk-width-1-1" placeholder={`New ${name} ${isOutput ? 'folder' : 'item'}...`} value={newChildName} onChange={e => setNewChildName(e.target.value)} />
                                </div>
                            </div>
                            <div className="uk-width-auto">
                                <div className="uk-button-group">
                                    {isOutput ||
                                        <button className="uk-button uk-button-small uk-button-primary uk-padding-remove" title="Create File" onClick={createFile} disabled={isInvalidName(newChildName)}>
                                            <span data-uk-icon="file-text"></span>
                                        </button>
                                    }
                                    <button className="uk-button uk-button-small uk-button-secondary uk-padding-remove" title="Create Directory" onClick={createDirectory} disabled={isInvalidName(newChildName)}>
                                        <span data-uk-icon="folder"></span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export const Browser = () => (
    <div className="uk-text-nowrap">
        <Directory path={MonaInputPath} isOutput={false} isRoot={true} />
        <Directory path={MonaOutputPath} isOutput={true} isRoot={true} />
    </div>
);
