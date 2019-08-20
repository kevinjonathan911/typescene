import { Component, ComponentEvent, managed } from "../core";
import { UIRenderable } from "./UIComponent";
import { UIRenderableController } from "./UIRenderableController";

/** Renderable wrapper that controls selection state across components, by emitting `Deselect` events for previously selected components upon `Select` events on newly selected components */
export class UISelectionController extends UIRenderableController {
    /** Create a new selection controller with given content */
    constructor(content?: UIRenderable) {
        super(content);
        this.propagateChildEvents(e => {
            // propagate all UI events, while managing selection state
            if (e instanceof ComponentEvent) {
                if (e.name === "Select" && e.source !== this.selected) {
                    let old = this.selected;
                    this.selected = e.source;
                    if (old) old.propagateComponentEvent("Deselect");
                }
                else if (e.name === "Deselect" && e.source === this.selected) {
                    this.selected = undefined;
                }
                return e;
            }
        });
    }

    /** Currently selected component, if any */
    @managed
    selected?: Component;
}
