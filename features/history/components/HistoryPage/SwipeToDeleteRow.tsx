import React, { useRef, useState } from "react";
import { Trash2 } from "lucide-react";

interface SwipeToDeleteRowProps {
  onDelete: () => void;
  children: React.ReactNode;
}

const DELETE_THRESHOLD = 72;
const MAX_SWIPE = 96;

export const SwipeToDeleteRow: React.FC<SwipeToDeleteRowProps> = ({ onDelete, children }) => {
  const [offset, setOffset] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const startXRef = useRef(0);
  const isSwipingRef = useRef(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX;
    isSwipingRef.current = false;
    setIsAnimating(false);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const diff = e.touches[0].clientX - startXRef.current;
    if (diff < -8) isSwipingRef.current = true;
    if (!isSwipingRef.current) return;
    if (diff < 0) setOffset(Math.max(diff, -MAX_SWIPE));
  };

  const handleTouchEnd = () => {
    setIsAnimating(true);
    if (offset <= -DELETE_THRESHOLD) {
      onDelete();
    } else {
      setOffset(0);
    }
  };

  const isFullyRevealed = offset <= -DELETE_THRESHOLD;

  return (
    <div className="relative overflow-hidden rounded-xl group">
      {/* Red delete affordance behind the row (revealed on swipe) */}
      <div
        className={`absolute inset-y-0 right-0 flex items-center justify-center w-20 rounded-r-xl transition-colors ${
          isFullyRevealed ? "bg-red-500" : "bg-red-500/15"
        }`}
      >
        <Trash2 size={15} className={isFullyRevealed ? "text-white" : "text-red-400/70"} />
      </div>

      {/* Swipeable row */}
      <div
        className="flex items-center"
        style={{
          transform: `translateX(${offset}px)`,
          transition: isAnimating ? "transform 0.2s ease" : "none",
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Day content — flex-1 so it shrinks when the desktop trash slides in */}
        <div className="flex-1 min-w-0">
          {children}
        </div>

        {/* Desktop trash — slides in as a flex sibling so it never overlaps content */}
        <div className="shrink-0 w-0 overflow-hidden group-hover:w-9 transition-[width] duration-150">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="w-9 h-full flex items-center justify-center text-slate-500 hover:text-red-400 transition-colors"
            aria-label="Delete day"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
};
