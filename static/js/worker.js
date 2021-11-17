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

self.importScripts('./render.js', './mona.js', 'dfa2dot.js', 'gta2dot.js');

const InputPath = '/input';
const OutputPath = '/output';

// run a emscripten module and capture its output
async function run(moduleDefinition, args, result, returnFile) {
    // load the module
    const stdout = [];
    const stderr = [];
    const module = await moduleDefinition({
        print: s => stdout.push(s),
        printErr: s => stderr.push(s),
    });

    // setup the file system
    module.FS.mkdir(InputPath);
    module.FS.mkdir(OutputPath);
    const InputDir = module.FS.mount(module.IDBFS, {}, InputPath);
    const OutputDir = module.FS.mount(module.IDBFS, {}, OutputPath);

    // restore mount points from IndexedDB
    const sync = (dir, direction) => new Promise((resolve, reject) => module.IDBFS.syncfs(dir.mount, direction, error => error ? reject(error) : resolve()));
    await sync(InputDir, true);
    await sync(OutputDir, true);

    // run the module and store /output to IndexedDB
    if ((result.exitCode = module.callMain(args)) !== 0) {
        throw new Error(stderr.concat(stdout).join('\n'));
    }
    await sync(OutputDir, false);
    return returnFile ? module.FS.readFile(returnFile, { encoding: 'utf8' }) : stdout;
}

// the current output state
const State = Object.freeze({
    Unknown: 0,
    Dfa: 1,
    CounterExample: 2,
    SatisfyingExample: 3,
    Timings: 4,
});

// significant Mona output strings
const Prefix = Object.freeze({
    Dfa: Object.freeze({
        FreeVariables: 'DFA for formula with free variables: ',
        InitialState: 'Initial state: ',
        States: Object.freeze({
            Accepting: 'Accepting states: ',
            Rejecting: 'Rejecting states: ',
            DontCare: 'Don\'t-care states: ',
        }),
    }),
    CounterExample: 'A counter-example ',
    SatisfyingExample: 'A satisfying example ',
    Timings: 'Total time: ',
});

// regexes for parsing
const Transition = /^State (?<from>\d+): (?<input>[01X]+) -> state (?<to>\d+)$/;
const Timing = /^(?<what>[^:]+): *(?<hours>\d\d):(?<minutes>\d\d):(?<seconds>\d\d).(?<hundredth>\d\d)$/;

// options for viz.js
const RenderOptions = {
    format: 'svg',
    engine: 'dot',
    files: [],
    images: [],
    yInvert: false,
    nop: 0
};

// parse an output line
function parseLine(result, state, s) {
    if (s.startsWith(Prefix.Dfa.FreeVariables)) {
        result.dfa = {
            freeVariables: s.substring(Prefix.Dfa.FreeVariables.length).split(' ').filter(s => s.length > 0),
            transitions: {},
        };
        return State.Dfa;
    }
    else if (s.startsWith(Prefix.CounterExample)) {
        result.counterExample = [];
        return State.CounterExample;
    }
    else if (s.startsWith(Prefix.SatisfyingExample)) {
        result.satisfyingExample = [];
        return State.SatisfyingExample;
    }
    else if (s.startsWith(Prefix.Timings)) {
        result.timings = {};
        state = State.Timings;
    }
    switch (state) {
        case State.Dfa:
            const dfa = result.dfa;
            const transition = s.match(Transition);
            if (transition) {
                const from = transition.groups.from;
                if (!(from in dfa.transitions)) {
                    dfa.transitions[from] = {};
                }
                const transitions = dfa.transitions[from];
                const input = transition.groups.input;
                if (!(input in transitions)) {
                    transitions[input] = [];
                }
                transitions[input].push(transition.groups.to);
            }
            else if (s.startsWith(Prefix.Dfa.InitialState)) {
                dfa.initialState = s.substring(Prefix.Dfa.InitialState.length);
            }
            else {
                for (const prefixName in Prefix.Dfa.States) {
                    const prefix = Prefix.Dfa.States[prefixName];
                    if (s.startsWith(prefix)) {
                        dfa[`${prefixName[0].toLowerCase()}${prefixName.substring(1)}States`] = s.substring(prefix.length).split(' ').filter(s => s.length > 0);
                        break;
                    }
                }
            }
            break;
        case State.CounterExample:
            result.counterExample.push(s);
            break;
        case State.SatisfyingExample:
            result.satisfyingExample.push(s);
            break;
        case State.Timings:
            const timing = s.match(Timing);
            if (!timing) {
                break;
            }
            result.timings[timing.groups.what] =
                parseInt(timing.groups.hours) * 60 * 60 * 1000 +
                parseInt(timing.groups.minutes) * 60 * 1000 +
                parseInt(timing.groups.seconds) * 1000 +
                parseInt(timing.groups.hundredth) * 10;
            break;
        case State.Unknown:
            break;
        default:
            throw new Error(`Unknown state: ${state}`);
    }
    return state;
}

// we do our own GraphViz construction in order to not call Mona twice
function buildGraph(dfa) {
    let graph = 'digraph MONA_DFA {\n rankdir=LR;\n center=true;\n size="9,10";\n edge [fontname=Courier];\n node [height=.5, width=.5];\n';
    if (dfa.acceptingStates) {
        graph += ` node [shape=doublecircle]; ${dfa.acceptingStates.join('; ')};\n`;
    }
    if (dfa.dontCareStates) {
        graph += ` node [shape=box]; ${dfa.dontCareStates.join('; ')};\n`;
    }
    graph += ` node [shape=circle];\n init [shape=plaintext, label="${dfa.freeVariables.join('\\n')}"];\n`;
    if (dfa.initialState) {
        graph += ` init -> ${dfa.initialState};\n`;
    }
    for (const from in dfa.transitions) {
        for (const input in dfa.transitions[from]) {
            for (const to of dfa.transitions[from][input]) {
                graph += ` ${from} -> ${to} [label="${input.split('').join('\\n')}"];\n`;
            }
        }
    }
    graph += '}';
    return render(graph, RenderOptions);
}

// execute mona
async function runMona(result, path) {
    const stdout = await run(MonaModule, ['-q', '-w', '-t', path], result, null);
    if (stdout.reduce((state, line) => parseLine(result, state, line), State.Unknown) !== State.Timings) {
        throw new Error(`Invalid output:\n${stdout.join('\n')}`);
    }
    if (result.dfa) {
        try { result.dfa.graph = buildGraph(result.dfa); }
        catch (error) { result.dfa.graph = String(error); }
    }
}

//execute dfa2dot
async function runA2Dot(result, module, path) {
    const TempFilePath = '/tmp/dot';
    const dot = await run(module, [path, TempFilePath], result, TempFilePath);
    result.dfa = { graph: render(dot.replace('orientation = landscape', ''), RenderOptions) };
}

self.onmessage = async e => {
    const result = { id: e.data.id };
    try {
        switch (e.data.module) {
            case 'mona': await runMona(result, e.data.path); break;
            case 'dfa2dot': await runA2Dot(result, Dfa2DotModule, e.data.path); break;
            case 'gta2dot': await runA2Dot(result, Gta2DotModule, e.data.path); break;
            default: throw new Error(`Unknown module: ${e.data.module}`);
        }
    }
    catch (error) {
        result.error = String(error);
    }
    self.postMessage(result);
}
