import * as Async from "@typescene/async";
import { Animation } from "../../Animation";
import { Drag } from "../../Drag";
import { Page } from "../../Page";
import { Screen } from "../../Screen";
import { Block } from "../";
import { Component } from "../Component";
import { ComponentFactory } from "../ComponentFactory";
import { ActionHandler, ComponentSignal } from "../ComponentSignal";
import { Container } from "./Container";

// TextButton is needed directly in static init of TopCloseButton:
import { TextButton } from "../Controls/Button";

/** Represents a modal dialog container */
export class DialogContainer extends Container {
    /** Create a new modal dialog with given content, if any */
    constructor(content?: Block[], width = "27rem") {
        super(content);
        this.width = width;

        // set default display options
        this.displayOptions = {
            modal: true,
            shade: true,
            modalHorzAlign: "center",
            outerMargin: ".5rem",
            onEsc: () => {
                Async.Promise.all(new this.Closing(undefined).emit().results)
                    .then(() => this.close());
            }
        };

        // add default animations
        if (!this.animations) this.animations = {};
        this.animations.appear = DialogContainer.APPEAR_ANIMATION;
        this.animations.disappear = DialogContainer.DISAPPEAR_ANIMATION;

        // set header as drag handle if none set explicitly
        this.Rendered.connect(() => {
            if (!this._dragHandleSet && this.header)
                Async.unobserved(() => { this.setDragHandle(this.header) });
        });
    }

    /** Default "appear" animation, added to every new DialogContainer instance by the constructor */
    public static APPEAR_ANIMATION?: Animation;

    /** Default "disappear" animation, added to every new DialogContainer instance by the constructor */
    public static DISAPPEAR_ANIMATION?: Animation;

    /** Initialize with given (observable) properties; returns this */
    public initializeWith: (values: DialogContainer.Initializer) => this;

    /** Block to be displayed as a header, may be undefined (observed) */
    @ComponentFactory.applyComponentRef(ComponentFactory.CLevel.Block)
    @Async.observable
    public header?: Block;

    /** Block to be displayed as a footer, may be undefined (observed) */
    @ComponentFactory.applyComponentRef(ComponentFactory.CLevel.Block)
    @Async.observable
    public footer?: Block;

    /** Remove the dialog from screen (does not emit or wait for `.Closing` signal, only emits `.Closed`); returns this */
    public close() {
        Screen.remove(this);
        this.Closed();
        return this;
    }

    /** Use given component as a drag handle for this dialog (and releases handle currently in use; defaults to .header) */
    public setDragHandle(handle?: Component) {
        this._dragHandleSet = true;
        if (this._dragHandleConnection)
            this._dragHandleConnection.disconnect();

        // listen to mouse down and start drag, then pick up container
        if (handle) {
            this._dragHandleConnection = handle.Press.connect(event => {
                Drag.start(event).moved
                    .then(drag => { drag.pickUp(this) });
            });
        }
    }

    /** Returns an array of directly contained components (observable) */
    public getChildren(): Component[] {
        var result = super.getChildren();
        if (this.header instanceof Component) result.unshift(this.header);
        if (this.footer instanceof Component) result.push(this.footer);
        return result;
    }

    /** Object with options to be used when displaying on a page (observed) */
    public displayOptions: Page.DisplayOptions;

    /** Signal emitted when user clicks outside dialog, presses esc or clicks DialogContainer.TopCloseButton; if any handler throws an error then the dialog will not close */
    public readonly Closing = this.defineComponentSignal(DialogContainer.CloseSignal);

    /** Signal emitted when this dialog has been closed */
    public readonly Closed = this.defineComponentSignal(DialogContainer.CloseSignal);

    /** @internal Signal connection for current drag handle mousedown events */
    private _dragHandleConnection: Async.SignalConnection;

    /** @internal True if a drag handle has been (un)set explicitly */
    private _dragHandleSet = false;
}

export namespace DialogContainer {
    /** Initializer for .with({ ... }) */
    export interface Initializer extends Container.Initializer {
        /** Property initializer: header block */
        header?: ComponentFactory.SpecEltOrList;
        /** Property initializer: footer block */
        footer?: ComponentFactory.SpecEltOrList;
        /** Signal initializer: method name or handler */
        Closing?: string | ActionHandler;
        /** Signal initializer: method name or handler */
        Closed?: string | ActionHandler;
    }

    /** Signal that is emitted when a dialog is closing or has closed */
    export class CloseSignal extends ComponentSignal<void> { }

    /** Predefined modal close button ("X") control, based on `TextButton` */
    export class TopCloseButton extends TextButton {
        /** Create a modal close button ("X") control */
        constructor() {
            super();
            this.label = "\u00D7";
            this.tooltipText = "Close";
            this.Click.connect(() => {
                var page = Page.getCurrentPage();
                page && page.handleEsc();
            });
        }
    }
}
