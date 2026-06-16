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
    <div className="relative overflow-hidden rounded-xl">
      {/* Red delete affordance revealed on swipe */}
      <div
        className={`absolute inset-y-0 right-0 flex items-center justify-center w-20 rounded-r-xl transition-colors ${
          isFullyRevealed ? "bg-red-500" : "bg-red-500/15"
        }`}
      >
        <Trash2 size={15} className={isFullyRevealed ? "text-white" : "text-red-400/70"} />
      </div>

      <div
        style={{
          transform: `translateX(${offset}px)`,
          transition: isAnimating ? "transform 0.2s ease" : "none",
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </div>
    </div>
  );
};
