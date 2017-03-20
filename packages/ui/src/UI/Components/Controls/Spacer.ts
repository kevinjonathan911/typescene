import { ComponentFactory, UIValueOrAsync } from "../ComponentFactory";
import { ControlElement } from "./ControlElement";

/** Represents an empty control element to take up horizontal space within a row */
export class Spacer extends ControlElement {
    /** Create a spacer element with given height (default 1px) */
    constructor(height = "1px") {
        super();
        this.height = height;
    }

    /** Initialize a spacer control factory with given size (CSS lengths); also sets `.shrinkwrap` to true if a width is given */
    public static withSize<T extends Spacer>(
        this: { new (): T, with: typeof Spacer.with },
        width?: UIValueOrAsync<string>,
        height?: UIValueOrAsync<string>) {
        return this.with(width ?
            { width, height, shrinkwrap: true } :
            { height });
    }

    /** Initialize with given (observable) properties; returns this */
    public initializeWith: (values: Spacer.Initializer) => this;
}

export namespace Spacer {
    /** Initializer for .with({ ... }) */
    export interface Initializer extends ControlElement.Initializer {
        // nothing here
    }
}
