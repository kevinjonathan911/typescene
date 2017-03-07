import { Block } from "../../../Components/Blocks/Block";
import { mapComponentRenderer } from "../../../Components/ComponentRenderer";
import { BlockControl } from "../../../Components/Controls/BlockControl";
import { Style } from "../../../Style";
import { Renderer as ControlRenderer } from "./ControlElement";

/** @internal DOM-specific component renderer */
@mapComponentRenderer(BlockControl)
export class Renderer<T extends BlockControl<Block>> extends ControlRenderer<T> {
    /** Generate rendered component output */
    protected render() {
        // get or create the current output object
        var out = super.render();

        // update with current block component
        out.updated = this.context.updateAsync([this.component.block]);

        return out;
    }
}
