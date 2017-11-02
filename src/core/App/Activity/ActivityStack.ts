import Async, { Signal } from "../../Async";
import { Activity } from "./Activity";

var _historyIdBase = "_A" + String(Math.random()).slice(-5);
var _nextHistoryId = 0;
var _nextTransitionID = 0;

var previousTransition: ActivityTransition | undefined;

/** Represents a stack of activated activities (like browser history) */
export class ActivityStack {
    /** Add an activity to the foreground asynchronously, does nothing if given activity was already in the foreground; returns Promise that resolves to the completed transition */
    public pushAsync(activity: Activity) {
        if (!(activity instanceof Activity))
            throw new Error("Invalid activity");

        // push activity and its parents on the stack
        return this._pushP = this._pushP
            .then(() => this._upToHubOrRoot(activity))
            .then(() => {
                return this._transitionP = this._transitionP
                    .then<ActivityTransition | undefined>(() => {
                        previousTransition = undefined;
                        var result: PromiseLike<ActivityTransition> | undefined;
                        this._findParents(activity).forEach(a => {
                            var p = () => this._processTransition(a,
                                ActivityTransition.Operation.Push);
                            result = result ? result.then(p) : p();
                        });
                        return result;
                    });
            });
    }

    /** Replace the current activity asynchronously (throws error if none), or remove current activity if given activity was already directly below current activity in the activity stack; returns Promise that resolves to the completed transition */
    public replaceAsync(activity: Activity) {
        if (!(activity instanceof Activity))
            throw new Error("Invalid activity");

        // process replace transaction
        return this._pushP = this._pushP
            .then(() => this._upToHubOrRoot(activity))
            .then(() => {
                return this._transitionP = this._transitionP
                    .then<ActivityTransition | undefined>(() => {
                        previousTransition = undefined;
                        var lonely = (this.topIndex < 0);

                        // pop if already directly below, otherwise replace or push
                        if (!lonely && this._stack[this.topIndex - 1] === activity)
                            return this._processTransition(
                                activity, ActivityTransition.Operation.Pop);
                        else {
                            // replace/push activity and its parents on the stack
                            var result: PromiseLike<ActivityTransition> | undefined;
                            this._findParents(activity, true).forEach(a => {
                                var p = () => this._processTransition(a,
                                    (result || lonely) ?
                                        ActivityTransition.Operation.Push :
                                        ActivityTransition.Operation.Replace);
                                result = result ? result.then(p) : p();
                            });
                            return result;
                        }
                    });
            });
    }

    /** Remove the current foreground activity (go back) asynchronously, returns Promise that resolves to the completed transition */
    public popAsync(): PromiseLike<ActivityTransition>;
    /** Remove the current foreground activity (go back) asynchronously if and only if it is the given activity, returns Promise that resolves to the completed transition, if any */
    public popAsync(activity: Activity): PromiseLike<ActivityTransition | undefined>;
    public popAsync(activity?: Activity): PromiseLike<ActivityTransition | undefined> {
        return this._transitionP = this._transitionP.then(() => {
            previousTransition = undefined;
            if (this.topIndex < 0)
                throw new Error("No activity to suspend");
            if (activity !== undefined && this.top !== activity)
                return <any>Async.Promise.resolve(undefined);

            // send signals and return promise
            return this._processTransition(this._stack[this.topIndex - 1],
                ActivityTransition.Operation.Pop);
        });
    }

    /** Remove foreground activities until given activity or activity of given type is in the foreground; returns Promise that resolves to activity, or undefined if there was no matching activity on the stack */
    public upAsync(activityOrClass: Activity | typeof Activity): PromiseLike<Activity | undefined> {
        var isActivity = (activityOrClass instanceof Activity);
        var result: Activity | undefined;
        var count = 0;
        var recurse = (last?: ActivityTransition) => {
            if (isActivity ?
                (this.top === activityOrClass) :
                (this.top instanceof <typeof Activity>activityOrClass)) {
                // arrived at given activity, stop now
                result = this.top;
                return last;
            }
            if (count < 1000 && this.contains(activityOrClass)) {
                // activity is still below, pop one and recurse
                count++;
                return this._processTransition(this._stack[this.topIndex - 1],
                    ActivityTransition.Operation.Pop)
                    .then<ActivityTransition | undefined>(t => (<any>recurse)(t));
            }

            // activity cannot be found, bail out
            return last;
        };
        return (this._transitionP = this._transitionP.then(() => {
            previousTransition = undefined;
            return recurse();
        })).then(() => result);
    }

    /** Get the activity closest to the foreground of the given type, if any (excluding foreground activity itself, and before given activity in second parameter, if any) */
    public getParent<T>(ActivityClass: typeof Activity & { new(...args: any[]): T },
        before?: Activity): T | undefined {
        var seenBefore = (this._stack[this.topIndex] === before);
        for (var i = this.topIndex - 1; i >= 0; i--) {
            if ((seenBefore || !before) &&
                this._stack[i] instanceof ActivityClass)
                return <any>this._stack[i];
            if (this._stack[i] === before)
                seenBefore = true;
        }
        return undefined;
    }

    /** Returns true if the stack contains given activity (or an activity that is an instance of given `Activity` class) */
    public contains(activityOrClass: Activity | typeof Activity) {
        if (activityOrClass instanceof Activity) {
            for (var i = this.topIndex; i >= 0; i--)
                if (this._stack[i] === activityOrClass) return true;
        }
        else {
            for (var i = this.topIndex; i >= 0; i--)
                if (this._stack[i] instanceof activityOrClass) return true;
        }

        return false;
    }

    /** Get the next activity ahead of the current stack top, if any (i.e. the activity that was most recently popped); returns undefined if there is no such activity */
    public peek(ignoreBackgroundActivities?: boolean) {
        for (var idx = this.topIndex + 1; idx < this._stack.length; idx++) {
            if (!ignoreBackgroundActivities || !this._stack[idx].options ||
                !this._stack[idx].options.isBackgroundActivity)
                return this._stack[idx];
        }
        return undefined;
    }

    /** The current foreground activity (top of stack, if any; observable) */
    public get top() {
        if (this.topIndex < 0) return undefined;
        return this._stack[this.topIndex];
    }

    /** The number of activities on the stack (observable) */
    public get length() {
        return this.topIndex + 1;
    }

    /** The title of the topmost activity that has a title defined (observable) */
    public get title() {
        for (var i = this.topIndex; i >= 0; i--)
            if (this._stack[i].title !== undefined)
                return this._stack[i].title;

        return "";
    }

    /** Create an activity cursor that starts at the top of this stack, and can move back on the stack and to parent activities; if the `activity` property is undefined, the cursor has reached the end; note that any changes to the stack while the cursor is in use may yield unexpected results */
    public getCursor(): ActivityStack.Cursor {
        let cursor = (idx: number, stack: Activity[]) => ({
            activityStack: this,
            clone: () => cursor(idx, stack),
            get activity() {
                if (idx >= stack.length) idx = stack.length - 1;
                if (idx < 0) return undefined;
                return stack[idx];
            },
            goBack() { idx--; return this },
            goParent() {
                var current = this.activity;
                if (current) {
                    var parent: any = current.options.parentActivity;
                    var isClass = (typeof parent === "function");
                    for (idx--; idx >= 0; idx--) {
                        current = stack[idx];
                        if (current === parent || isClass &&
                            (current instanceof parent))
                            return this;
                    }
                }
                return this;
            }
        });
        return cursor(this.topIndex, this._stack);
    }

    /** Signal that is emitted when an activity transition occurs (after Starting/Resuming/Suspending but before Started/Resumed) */
    public readonly Transition = Signal.create<ActivityTransition>();
    
    /** Synchronous Transition signal used by onTransitionSync */
    public readonly TransitionSync = Signal.create<ActivityTransition>();

    /** Add a handler to be invoked _synchronously_ when an activity transition occurs (after Starting/Resuming/Suspending but before Started/Resumed; after updating the activity stack) */
    public onTransitionSync(callback: (t: ActivityTransition) => void) {
        this.TransitionSync.connect(callback);
    }

    /** Checks position of given history state compared to the current activity; returns -1 if given state is behind (i.e. below current stack top), 0 if on par, or 1 if given state is ahead, undefined if not found (most likely replaced) */
    public getHistoryPosition(historyId: string) {
        var idx = this._historyIds.lastIndexOf(historyId);
        var top = this.topIndex;
        if (idx < 0) return undefined;
        if (idx === top) return 0;
        return idx < top ? -1 : 1;
    }
    
    /** Returns history ID, title, path, and reference to current activity, if any */
    public getHistoryState() {
        var idx = this.topIndex;
        if (idx < 0) return undefined;
        var activity = this._stack[idx];
        var path: string | undefined;
        try { path = activity.activation.getPath() }
        catch { }
        return {
            title: this.title,
            historyId: this._historyIds[idx],
            activity, path
        };
    }

    /** Returns history ID, title, path, and activity on the stack immediately after given history state (i.e. next activity to be added to the platform history), excluding background activities; returns undefined if given state is not found or if there is no activity after given history state */
    public getHistoryAfter(historyId: string) {
        var idx = this._historyIds.lastIndexOf(historyId);
        if (historyId && idx < 0) return undefined;
        var top = this.topIndex;
        while (++idx <= top &&
                this._stack[idx].options &&
                this._stack[idx].options.isBackgroundActivity) {
            // move past background activity/ies...
        }
        if (idx > top) return undefined;

        // get title of this or previous activity/ies
        var title = this.title;
        for (var i = idx; i >= 0; i--) {
            if (this._stack[i].title !== undefined) {
                title = this._stack[i].title!;
                break;
            }
        }

        // return all properties in one object
        var activity = this._stack[idx];
        var path: string | undefined;
        try { path = activity.activation.getPath() }
        catch { }
        return {
            title, activity, path,
            historyId: this._historyIds[idx]
        };
    }

    /** Helper method to find parent activity/ies for given activity; returns an array of activities to be pushed (including activity itself) */
    private _findParents(activity: Activity, excludeTop?: boolean) {
        var result = [activity];
        while (result[0].options.parentActivity) {
            // ensure parent is on stack somewhere
            var parent = result[0].options.parentActivity!;
            if (parent instanceof Activity) {
                if (this.contains(parent) &&
                    (!excludeTop || this.top !== parent))
                    break;
                result.unshift(parent);
            }
            else {
                if ((!excludeTop && (this.top instanceof parent)) ||
                    this.getParent(parent))
                    break;
                result.unshift(parent.getInstance());
            }
        }
        return result;
    }

    /** Helper method to move up to existing root activity, or hub parent activity if needed */
    private _upToHubOrRoot(activity: Activity) {
        var poppedP = this._popTransient();

        // check if activity is a root activity and move up if possible
        if (activity.options.isRootActivity && this.contains(activity)) {
            return poppedP.then(() => this.upAsync(activity))
                .then(t => Async.sleep(2, t) as typeof poppedP);
        }
        else {
            // find out if existing parent activity is a hub activity
            var parent: Activity | typeof Activity | undefined;
            if (parent = activity.options.parentActivity) {
                if (!(parent instanceof Activity))
                    parent = this.getParent(parent);
                if (parent && parent.options.isHubActivity) {
                    return poppedP.then(() => this.upAsync(parent!))
                        .then(t => Async.sleep(2, t) as typeof poppedP);
                }
            }
        }
        return poppedP;
    }

    /** Helper method to remove a transient activity if needed */
    private _popTransient() {
        if (this.top && this.top.options.isTransient) {
            var current = this.getCursor();
            while (current.activity && current.activity.options.isTransient) {
                current.goBack();
            }
            if (current.activity) this.upAsync(current.activity);
        }
        return this._transitionP;
    }

    /** Helper method for sending signals and creating promise */
    private _processTransition(to: Activity, op: ActivityTransition.Operation):
        PromiseLike<ActivityTransition> {
        // create transition operation
        var t = Object.freeze(<ActivityTransition>{
            id: "T" + _nextTransitionID++,
            activityStack: this,
            op, to, from: this.top,
            previous: previousTransition
        });
        previousTransition = t;

        // check if anything to do at all
        if (this.top === to) {
            if (op === ActivityTransition.Operation.Pop) this.topIndex--;
            return Async.Promise.resolve(t);
        }

        // gather promises for Suspending results
        var top = this.top;
        var suspense = top ? new top.Suspending(t).emit().results : [];

        // try to activate/resume new activity and return promise
        var resuming = !!to && this.contains(to);
        return Async.Promise.all(suspense)
            .then(() => {
                // signal that transition is about to happen
                return Async.Promise.all(resuming ?
                    new t.to.Resuming(t).emit().results :
                    t.to ? new t.to.Starting(t).emit().results : [])
            })
            .then(() => {
                // when all handlers are OK, go ahead:
                this.Transition(t);
                switch (t.op) {
                    case ActivityTransition.Operation.Pop:
                        // just decrease stack top
                        this.topIndex--;
                        break;
                    case ActivityTransition.Operation.Replace:
                        // decrease stack top and then push
                        this.topIndex--;
                    case ActivityTransition.Operation.Push:
                        // only move stack top if same activity above
                        if (this._stack.length > this.topIndex + 1 &&
                            this._stack[this.topIndex + 1] === t.to) {
                            this.topIndex++;
                        }
                        else {
                            // deactivate overwritten stack top
                            while (this._stack.length > this.topIndex + 1) {
                                var oldTop = this._stack.pop()!;
                                if (!this.contains(oldTop))
                                    oldTop.Deactivated(t);
                            }

                            // push new activity
                            this.topIndex = this._stack.push(t.to) - 1;
                            this._historyIds.length = this._stack.length;
                            this._historyIds[this.topIndex] =
                                _historyIdBase + _nextHistoryId++;
                        }
                }

                // signal that transition has happened
                this.TransitionSync.emitSync(t);
                if (t.to) {
                    if (!resuming) t.to.Started(t);
                    t.to.Resumed(t);
                }
                top && top.Suspended(t);
                return t;
            });
    }

    /** @internal */
    private get topIndex() { return this._idx.value! }
    private set topIndex(v) { this._idx.value = v }
    private _idx = Async.ObservableValue.fromValue(-1);

    private _stack = new Async.ObservableArray<Activity>();
    private _historyIds: string[] = [];
    private _transitionP: PromiseLike<ActivityTransition | undefined> = Async.Promise.resolve(undefined);
    private _pushP: PromiseLike<ActivityTransition | undefined> = Async.Promise.resolve(undefined);
}
export namespace ActivityStack {
    export interface Cursor {
        /** The activity stack that this cursor was created on */
        readonly activityStack: ActivityStack;

        /** The current activity; if this is undefined, the cursor has moved past the end (bottom) of the stack */
        readonly activity?: Activity;

        /** Move down the stack to the previous activity; returns this */
        goBack(): this;

        /** Move down the stack to the current activity's parent activity, if any; if there is no parent activity, the cursor will move past the end and stop; returns this */
        goParent(): this;

        /** Copy this cursor to another instance that can move independently */
        clone(): Cursor;
    }
}

/** Represents a transition from one foreground activity to another */
export interface ActivityTransition {
    /** Unique ID for this transition */
    id: string;

    /** The activity stack that is transitioning */
    activityStack: ActivityStack;

    /** The activity that is currently in the foreground, if any */
    from: Activity;

    /** The new foreground activity, if any */
    to: Activity;

    /** The stack operation being performed: push, replace, or pop */
    op: ActivityTransition.Operation;

    /** The previous transition that is part of the same operation (pop/push/up) */
    previous: ActivityTransition;
}
export namespace ActivityTransition {
    /** Operation type that triggered a transition */
    export enum Operation {
        /** Push operation */
        Push,
        /** Replace operation */
        Replace,
        /** Pop operation */
        Pop
    };
}
