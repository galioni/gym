import React from 'react';
import { cn } from '../../utils';

interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode;
  headerAction?: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({ className, title, headerAction, children, ...props }) => {
  return (
    <div className={cn("glass rounded-2xl p-5 shadow-lg shadow-black/20", className)} {...props}>
      {(title || headerAction) && (
        <div className="flex items-center justify-between mb-5 pb-3 border-b border-white/5">
          {title && <h2 className="text-lg font-semibold text-white tracking-tight">{title}</h2>}
          {headerAction && <div>{headerAction}</div>}
        </div>
      )}
      {children}
    </div>
  );
};