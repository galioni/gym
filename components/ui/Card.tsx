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
        <div className="flex items-center justify-between mb-5 pb-3 border-b border-white/10">
          {title && <h2 className="display-title text-2xl md:text-[1.75rem] text-white tracking-[0.05em]">{title}</h2>}
          {headerAction && <div>{headerAction}</div>}
        </div>
      )}
      {children}
    </div>
  );
};
