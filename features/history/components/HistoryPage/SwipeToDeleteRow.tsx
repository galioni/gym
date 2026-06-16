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
      {/* Delete affordance revealed behind the row on swipe */}
      <div
        className={`absolute inset-y-0 right-0 flex items-center justify-center w-20 rounded-r-xl transition-colors ${
          isFullyRevealed ? "bg-red-500" : "bg-red-500/15"
        }`}
      >
        <Trash2 size={15} className={isFullyRevealed ? "text-white" : "text-red-400/70"} />
      </div>

      {/* Swipeable content */}
      <div
        className="relative"
        style={{
          transform: `translateX(${offset}px)`,
          transition: isAnimating ? "transform 0.2s ease" : "none",
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
        {/* Desktop hover delete — sibling of children to avoid nested-button issues */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover:inline-flex items-center justify-center h-7 w-7 text-slate-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
          aria-label="Delete day"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
};
