import React from 'react';
import { cn } from '../../utils';

interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode;
  headerAction?: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({ className, title, headerAction, children, ...props }) => {
  return (
    <div className={cn("glass rounded-[var(--radius-card)] p-5 md:p-6 border border-white/10", className)} {...props}>
      {(title || headerAction) && (
        <div className="mb-4 pb-2.5 border-b border-white/10">
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
            {title && (
              <h2 className="display-title leading-tight text-xl sm:text-2xl md:text-[1.72rem] text-white tracking-[0.04em] break-words">
                {title}
              </h2>
            )}
            {headerAction && <div className="w-full sm:w-auto sm:shrink-0">{headerAction}</div>}
          </div>
        </div>
      )}
      {children}
    </div>
  );
};
