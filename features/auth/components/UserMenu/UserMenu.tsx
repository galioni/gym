import React from "react";
import { LogOut } from "lucide-react";
import { Button } from "../../../../components/ui/Button";

interface UserMenuProps {
  email: string;
  isWorking: boolean;
  onSignOut: () => Promise<void>;
}

export const UserMenu: React.FC<UserMenuProps> = ({ email, isWorking, onSignOut }) => {
  return (
    <div className="fixed right-4 top-3 z-50 flex items-center gap-2 rounded-full border border-white/15 bg-background/75 px-3 py-2 backdrop-blur-xl">
      <span className="max-w-[170px] truncate text-xs tracking-[0.05em] text-slate-300">{email}</span>
      <Button
        size="sm"
        variant="ghost"
        className="min-h-8 px-2 text-[11px]"
        onClick={() => void onSignOut()}
        disabled={isWorking}
        title="Sign out"
      >
        <LogOut size={14} />
      </Button>
    </div>
  );
};
