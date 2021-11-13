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

import UIkit from 'uikit';

export async function prompt(message: string): Promise<string | null> {
    try {
        return await UIkit.modal.prompt(message, '');
    } catch {
        return window.prompt(message);
    }
}

export async function confirm(message: string): Promise<boolean> {
    try {
        await UIkit.modal.confirm(message);
        return true;
    } catch (error) {
        return error ? window.confirm(message) : false;
    }
}

export async function alert(message: string): Promise<void> {
    try {
        await UIkit.modal.alert(message);
    } catch {
        window.alert(message);
    }
}
