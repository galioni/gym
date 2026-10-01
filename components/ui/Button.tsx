import React from 'react';
import { cn } from '../../utils';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'icon';
}

export const Button: React.FC<ButtonProps> = ({ 
  className, 
  variant = 'secondary', 
  size = 'md', 
  ...props 
}) => {
  const variants = {
    primary: "bg-gradient-to-r from-primary to-primaryHover text-onPrimary shadow-lg shadow-primary/25 border-transparent hover:brightness-105",
    secondary: "bg-surfaceHighlight/55 hover:bg-surfaceHighlight/80 text-label border-border hover:border-primary/40",
    danger: "bg-danger/10 hover:bg-danger/20 text-dangerText border-danger/30 hover:border-danger/60",
    ghost: "bg-transparent hover:bg-fill/10 text-labelSecondary hover:text-label border-transparent"
  };

  const sizes = {
    sm: "min-h-11 px-3 py-2 text-xs",
    md: "min-h-11 px-5 py-2.5 text-sm",
    icon: "h-11 w-11 inline-flex items-center justify-center"
  };

  return (
    <button 
      className={cn(
        "inline-flex items-center justify-center rounded-xl border font-medium transition-all duration-200 active:scale-95 focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50 disabled:pointer-events-none disabled:active:scale-100",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  );
};
