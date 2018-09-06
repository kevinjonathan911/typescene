import { Component } from "./Component";
import { ManagedList } from "./ManagedList";
import { ManagedMap } from "./ManagedMap";
import { logUnhandledException } from "./UnhandledErrorEmitter";
import { BINDING_ID_PREFIX } from "./util";

/** Running ID for new `Binding` instances */
let _nextBindingUID = 16;

/**
 * Represents a value to be included in `Component` presets (using the static `Component.with` method), to be updated asynchronously from a property on active composite objects (see `@compose`).
 * Bindings should be created using the `bind` and `bindf` functions, and assigned to a property of a single object passed to `Component.with`.
 */
export class Binding {
    /** Returns true if given value is an instance of `Binding` */
    static isBinding(value: any): value is Binding {
        return !!(value && value.isComponentBinding && (value instanceof Binding));
    }

    /** Create a new binding for given property and default value. See `bind`. */
    constructor(source?: string, defaultValue?: any) {
        let path: string[] | undefined;
        let propertyName = source !== undefined ? String(source) : undefined;

        // parse property name, path, and filters
        if (propertyName !== undefined) {
            let parts = String(propertyName).split("|");
            path = parts.shift()!.split(".");
            propertyName = path.shift();
            if (!path.length) path = undefined;
            for (let part of parts) this.addFilter(part);
        }
        this.propertyName = propertyName;

        // create a reader class that provides a value getter
        let self = this;
        this.Reader = class {
            /** Create a new reader, linked to given composite object */
            constructor(public readonly composite: Component) { }

            /** The current (filtered) value for this binding */
            getValue(propertyHint?: any) {
                let result = arguments.length > 0 ? propertyHint :
                    propertyName !== undefined ?
                    (this.composite as any)[propertyName] :
                    undefined;

                // find nested properties and mapped keys
                if (path) {
                    for (let i = 0; i < path.length && result != undefined; i++) {
                        let p = path[i];
                        if (result instanceof ManagedList) {
                            // check for toArray or pluck prefix
                            if (p === "*") {
                                result = result.toArray();
                                continue;
                            }
                            else if (p[0] === "*") {
                                result = result.pluck(p.slice(1));
                                continue;
                            }
                        }
                        else if (result instanceof ManagedMap) {
                            // check for toObject or key prefix
                            if (p === "#") {
                                result = result.toObject();
                                continue;
                            }
                            else if (p[0] === "#") {
                                result = result.get(p.slice(1));
                                continue;
                            }
                        }
                        result = result[p];
                    }
                }

                // return filtered result
                if (self._filter) {
                    result = self._filter(result);
                }
                return (result === undefined && defaultValue !== undefined) ?
                    defaultValue : result;
            }
        }
    }

    /** Method for duck typing, always returns true */
    isComponentBinding(): true { return true }

    /** Unique ID for this binding */
    readonly id = BINDING_ID_PREFIX + _nextBindingUID++;

    /** @internal Constructor for a reader, that reads current bound and filtered values */
    Reader: {
        new(composite: Component): {
            readonly composite: Component;
            getValue(hint?: any): any;
        }
    };

    /** Name of the property that should be observed for this binding (highest level only, does not include names of nested properties or keys) */
    readonly propertyName?: string;

    /** Nested bindings, if any (e.g. for string format bindings, see `bindf`) */
    readonly bindings?: ReadonlyArray<Binding>;

    /** Parent binding, if any (e.g. for nested bindings in string format bindings) */
    parent?: Binding;

    /**
     * Add a filter to this binding, which transforms values to a specific type or format. These can be chained by adding multiple filters in order of execution.
     * Filters can also be specified after the `|` (pipe) separator in string argument given to the `Binding` constructor, or `bind` function.
     * Available bindings include:
     * - `s`, `str`, or `string`: convert non-undefined values to a string using the `String(...)` function.
     * - `n`, `num`, or `number`: convert non-undefined values to a floating-point number using the `parseFloat(...)` function.
     * - `i`, `int`, or `integer`: convert values to whole numbers using the `Math.round(...)` function. Undefined values are converted to `0`.
     * - `dec(1)`, `dec(2)`, `dec(3)` etc.: convert values to decimal numbers as strings, with given number of fixed decimals.
     * - `?` or `!!`, `not?` or `!`: convert values to boolean, applying boolean NOT for `!` and `not?`, and NOT-NOT for `?` and `!!`.
     * - `or(...)`: use given string if value is undefined or a blank string; the string cannot contain a `}` character.
     * - `uniq`: leave only unique values in an array, and discard undefined values
     * - `blank` or `_`: output an empty string, but make the unfiltered value available for the #{...} pattern in `bindf`.
     */
    addFilter(fmt: string) {
        fmt = String(fmt).trim();

        // split format into ID and arguments
        let argIdx = fmt.indexOf("(");
        let arg: string | undefined;
        if (argIdx > 0 && fmt.slice(-1) === ")") {
            arg = fmt.slice(argIdx + 1, -1).trim();
            fmt = fmt.slice(0, argIdx).trim();
        }
        
        // select a filter by ID
        let filter = Binding.filters[fmt];
        if (!filter) throw Error("[Binding] Unknown binding filter: " + fmt);

        // store new chained filter
        let oldFilter = this._filter;
        this._filter = v => {
            if (oldFilter) v = oldFilter(v);
            return filter(v, arg);
        }
        return this;
    }

    /** Chained filter function, if any */
    private _filter?: (v: any) => any;

    /** List of applicable filters, new filters may be added here */
    static readonly filters: { [id: string]: (v: any, ...args: any[]) => any } = {
        "!": v => !v,
        "not?": v => !v,
        "?": v => !!v,
        "!!": v => !!v,
        "or": (v, alt) => (v || alt),
        "s": _stringFormatter,
        "str": _stringFormatter,
        "string": _stringFormatter,
        "uc": _ucFormatter,
        "lc": _lcFormatter,
        "blank": _blankFormatter,
        "_": _blankFormatter,
        "n": _floatFormatter,
        "num": _floatFormatter,
        "number": _floatFormatter,
        "i": _intFormatter,
        "int": _intFormatter,
        "integer": _intFormatter,
        "dec": _decimalFormatter,
        "uniq": _uniqueFormatter
    }
}

/**
 * Represents a set of bindings (see `Binding`) that are compiled into a single string value.
 * String format bindings should be created using the `bindf` function instead of this constructor.
 */
export class StringFormatBinding extends Binding {
    /** Creates a new binding for given format string. See `bindf`. */
    constructor(text: string) {
        super(undefined);
        text = String(text);

        // prepare bindings for all tags in given format string
        let bindings: Array<Binding> = [];
        let bindSources: string[] = [];
        let indexBySource: { [s: string]: number } = {};
        let match = text.match(/\$\{([^\}]+)\}/g);
        if (match) {
            for (let s of match) {
                let binding = new Binding(s.slice(2, -1), "");
                binding.parent = this;
                indexBySource[s] = bindings.length;
                bindings.push(binding);
                bindSources.push(s);
            }
        }

        // amend reader to get values from bindings and compile text
        this.Reader = class extends this.Reader {
            getValue() {
                // take values for all bindings first
                let values = bindings.map((binding, i) => {
                    let bound = this.composite.getBoundBinding(binding);
                    if (!bound) {
                        throw TypeError("[Binding] Binding not found for " + bindSources[i]);
                    }
                    return bound.value;
                });

                // replace all tags for bindings and pluralizers in format string
                let lastIndex = 0;
                let result = text
                    .replace(/[\$\#]\{(?:(\d+)\:)?([^\}]+)\}/g, (tag, idx, s) => {
                        if (tag[0] === "$") {
                            // replace with plain binding value
                            lastIndex = indexBySource[tag];
                            return lastIndex >= 0 ? _stringFormatter(values[lastIndex]) : "";
                        }
                        else {
                            // replace with pluralization option
                            let bindingIndex = idx ? Number(idx) - 1 : lastIndex;
                            return _pluralFormatter(values[bindingIndex], s);
                        }
                    });
                return super.getValue(result);
            }
        };

        // store bindings for use by component constructor
        this.bindings = bindings;
    }

    /** Nested `Binding` instances for all bindings in the format string */
    readonly bindings: ReadonlyArray<Binding>;
}

export namespace Binding {
    /**
     * @internal A list of components that are actively bound to a specific binding. Also includes a method to update the value on all components, using the `Component.updateBoundValue` method.
     */
    export class Bound extends ManagedList<Component> {
        /** Create a new bound instance for given binding and host composer */
        constructor(public binding: Binding, composite: Component) {
            super();
            if (binding.parent) {
                // find bound parent first
                let parent = composite.getBoundBinding(binding.parent);
                if (!parent) {
                    throw TypeError("[Binding] Bound parent binding not found for: " +
                        binding.propertyName);
                }
                this.parent = parent;
            }

            // set own properties
            this.propertyName = binding.propertyName;
            this._reader = new binding.Reader(composite);
        }

        /** Bound parent binding */
        readonly parent?: Bound;

        /** Bound property name (highest level only, same as `Binding.propertyName`) */
        readonly propertyName?: string;

        /** Returns true if there already is an actively bound value */
        hasValue() { return !!this._updatedValue }

        /** The current bound value, taken from the composite object (or cached) */
        get value() {
            // use existing value, or get a value from the reader
            return this._updatedValue ? this._lastValue :
                this._reader.getValue();
        }

        /** Update all components in the list with a new value. The current value of the source property (i.e. using `Binding.propertyName`) may be passed in if it is already known. */
        updateComponents(v?: any) {
            if (!this.count && !this.parent) return;

            // get a new value and check if an update is even necessary
            let value = this._reader.getValue(...arguments);
            if (!this._updatedValue || this._lastValue !== value) {
                this._updatedValue = true;
                this._lastValue = value;
                if (this.parent) {
                    // update parent instead
                    this.parent.updateComponents();
                    return;
                }
                
                // go through all components and update the bound value
                let id = this.binding.id;
                this.forEach((component: any) => {
                    try {
                        if (typeof component[id] !== "function") {
                            throw Error("[Binding] Component not bound");
                        }
                        component[id](value);
                    }
                    catch (err) {
                        logUnhandledException(err)
                    }
                });
            }
        }

        private _reader: InstanceType<Binding["Reader"]>;
        private _updatedValue?: boolean;
        private _lastValue: any;
    }
}

/**
 * Returns a new binding, which can be used as a component preset (see `Component.with`) to update components dynamically with the value of an observed property on the composite object.
 * 
 * The property name is specified in the first argument. Nested properties are allowed (e.g. `foo.bar`), but only the highest level property will be observed. Hence, changes to nested properties may not be reflected in bound values unless a change event is emitted on the highest level property.
 * 
 * Mapped objects in a `ManagedMap` can be bound using a `#` prefix for keys (e.g. `map.#key`).
 * A `ManagedMap` can be bound as a plain object using a `#` nested property (e.g. `map.#`).
 * Properties of all objects in a `ManagedList` can be bound (as an array) using a `*` prefix for the nested property (e.g. `list.*foo`).
 * A `ManagedList` can be bound as a plain array using a `*` nested property (e.g. `list.*`).
 * 
 * The property name may be appended with a `|` (pipe) character and a *filter* name: see `Binding.addFilter` for available filters. Multiple filters may be chained together if their names are separated with more pipe characters.
 * 
 * A default value may also be specified. This value is used when the bound value itself is undefined.
 */
export function bind(propertyName?: string, defaultValue?: any) {
    return new Binding(propertyName, defaultValue);
}

/**
 * Returns a new binding, which can be used as a component preset (see `Component.with`) to update components dynamically with a string that includes property values from the composite object.
 * 
 * A format string should be passed as a first argument. The text is bound as-is, with the following types of tags replaced:
 * 
 * - `${binding.foo|filter}`: inserts a bound value, as if the tag content was used as a parameter to `bind`.
 * - `#{one/two}`: inserts one of the given options, based on the value of the previous (or first) binding as an absolute number _or_ length of an array or managed list. The order of given options is 1/other, 0/1/other, 0/1/2/other, etc., unless handled differently by the current language service. Within the options, `#_` is replaced with the value of the relevant binding.
 * - `#{2:one/two}`: as above, but refers to the binding at given index (base 1) instead of the previous binding.
 * 
 * @note To use plurals or number forms based on values that should not be included in the output themselves, use the `_` (blank) filter, e.g. `"There ${n|_}#{are no/is one/are #_} item#{/s}"`.
 */
export function bindf(text: string) {
    return new StringFormatBinding(text);
}

// formatting helper functions:
function _formatNotUndefined<T extends U, Z, U>(v: T, f: (v: T) => Z, u: U = v) {
    return v != undefined ? f(v) : u;
}
function _blankFormatter(d: any) {
    if (d != undefined && typeof d.valueOf === "function") {
        d = d.valueOf();
    }
    return {
        toString() { return "" },
        valueOf() { return d }
    }
}
function _stringFormatter(d: any): string {
    if (typeof d === "object") {
        if (d.toString === Object.prototype.toString) {
            logUnhandledException(
                TypeError("[Binding] Cannot convert bound object value to string, replacing with '???'"));
            return "???";
        }
        if (d.toString === Array.prototype.toString &&
            d.map === Array.prototype.map) {
            return (d as any[]).map(_stringFormatter).join(", ");
        }
    } 
    return _formatNotUndefined(d, String, "");
}
function _ucFormatter(d: any) {
    let result = _stringFormatter(d);
    return result && result.toLocaleUpperCase();
}
function _lcFormatter(d: any) {
    let result = _stringFormatter(d);
    return result && result.toLocaleLowerCase();
}
function _floatFormatter(d: any) {
    return _formatNotUndefined(d, parseFloat);
}
function _intFormatter(d: any) {
    let result = Math.round(_formatNotUndefined(d, parseFloat, 0));
    return result > 0 ? result : result < 0 ? result : 0;
}
function _decimalFormatter(n: any, decimals: number | string) {
    if (n == undefined) return "";
    decimals = +decimals;
    let shifted = Math.round((parseFloat(n) + "e+" + decimals) as any);
    return Number(shifted + "e-" + decimals).toFixed(decimals);
}
function _uniqueFormatter(d: any) {
    if (d instanceof ManagedList) d = d.toArray();
    if (!Array.isArray(d)) return d;
    let values: any[] = [];
    let strings: any = {};
    return d.filter(v => {
        if (v == undefined) return false;
        if (typeof v === "string") {
            if (strings[v]) return false;
            return (strings[v] = true);
        }
        if (values.indexOf(v) >= 0) return false;
        values.push(v);
        return true;
    });
}
function _pluralFormatter(n: any, forms: string) {
    if (typeof n === "object") {
        if (Array.isArray(n)) n = n.length;
        else if (n instanceof ManagedList) n = n.count;
        else if (typeof n.valueOf === "function") {
            n = n.valueOf();
            if (Array.isArray(n)) n = n.length;
            else if (n instanceof ManagedList) n = n.count;
        }
    }
    let options = forms.split("/");
    let value = (typeof n === "string" ?
        parseFloat(n) : Number(n)) || 0;
    let absValue = Math.abs(value);
    let result: string;
    if (options.length === 2) {
        // pick from one/other
        result = options[absValue >= 1 && absValue < 2 ? 0 : 1];
    }
    else {
        // otherwise pick from zero/one/etc...
        result = options[Math.min(options.length - 1, Math.floor(absValue))];
    }
    return result.replace(/#_/g, String(value));
}