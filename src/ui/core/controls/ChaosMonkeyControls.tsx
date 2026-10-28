import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import type { PlaybackControlsProps } from "./PlaybackControls.types.js";
import { PlaybackControls } from "./PlaybackControls.js";
import "./ChaosMonkeyControls.css";

/** Mount in the map's overlay slot. Opening the panel never starts playback. */
export function ChaosMonkeyControls(props: PlaybackControlsProps): ReactElement {
    const [open, setOpen] = useState(false);
    const id = useId();
    const trigger = useRef<HTMLButtonElement>(null);
    const closeButton = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (open) closeButton.current?.focus({ preventScroll: true });
    }, [open]);

    function close(): void {
        setOpen(false);
        trigger.current?.focus({ preventScroll: true });
    }

    return <div className="chaos-monkey-dock" onKeyDown={event => {
        if (open && event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
        }
    }}>
        {/* Keep the controls mounted so closing/reopening cannot reset an in-flight command guard. */}
        <div className="chaos-monkey-panel" hidden={!open} role="dialog" aria-labelledby={`${id}-heading`} id={`${id}-panel`}>
            <header className="chaos-monkey-heading">
                <h2 id={`${id}-heading`}>Chaos monkey</h2>
                <button ref={closeButton} type="button" className="chaos-monkey-close" aria-label="Close chaos monkey" onClick={close}>×</button>
            </header>
            <PlaybackControls {...props} />
        </div>
        <div className="chaos-monkey-launcher">
            <button ref={trigger} type="button" className="chaos-monkey-trigger" title="Chaos monkey"
                aria-label="Chaos monkey" aria-expanded={open} aria-controls={`${id}-panel`} aria-haspopup="dialog"
                aria-describedby={`${id}-tooltip`} onClick={() => open ? close() : setOpen(true)}>
                <span aria-hidden="true">🐒</span>
            </button>
            <span className="chaos-monkey-tooltip" role="tooltip" id={`${id}-tooltip`}>Chaos monkey</span>
        </div>
    </div>;
}
