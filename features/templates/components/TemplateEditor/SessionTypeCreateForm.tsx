import React, { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "../../../../components/ui/Button";
import { CreateSessionTypeResult } from "../../../../application/workout/sessionTypes/sessionTypeRules";

interface SessionTypeCreateFormProps {
  onCreateSessionType: (label: string) => Promise<CreateSessionTypeResult>;
  onCreated: (sessionType: string) => void;
  onShowMessage: (result: CreateSessionTypeResult) => void;
}

export const SessionTypeCreateForm: React.FC<SessionTypeCreateFormProps> = ({
  onCreateSessionType,
  onCreated,
  onShowMessage,
}) => {
  const [label, setLabel] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    const result = await onCreateSessionType(label);
    onShowMessage(result);
    setLabel("");
    if (result.status === "success" && result.sessionType) {
      onCreated(result.sessionType);
    }
    setIsSubmitting(false);
  };

  return (
    <>
      <input
        type="text"
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        placeholder="New session type"
        className="bg-background/70 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-200 focus:ring-2 focus:ring-primary/50 outline-none"
      />
      <Button
        variant="secondary"
        size="sm"
        className="min-h-11 gap-2"
        onClick={() => void handleSubmit()}
        disabled={isSubmitting || label.trim().length === 0}
      >
        <Plus size={14} />
        Add Session Type
      </Button>
    </>
  );
};