import { useState } from "react";
import type { Project } from "@socialsync/shared";
import { useRouteMutation } from "@/hooks/use-route-interaction";
import { Modal, ErrorMessage } from "@/components/feedback/Feedback";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
export function ProjectDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (project: Project) => void;
}) {
  const [name, setName] = useState("");
  const [timeZone, setTimeZone] = useState("Asia/Kolkata");
  const create = useRouteMutation<Project>(
    "/resources/projects",
    () => ({ intent: "create-project", name, timeZone }),
    onCreated,
  );
  return (
    <Modal title="Create a project" onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <input type="hidden" name="intent" value="create-project" />
        <label>
          Project name
          <Input
            name="name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Studio North"
            required
            maxLength={80}
          />
        </label>
        <label>
          Time zone
          <Input
            name="timeZone"
            value={timeZone}
            onChange={(e) => setTimeZone(e.target.value)}
            required
          />
        </label>
        <ErrorMessage error={create.error} />
        <Button disabled={create.isPending || !name.trim()}>
          {create.isPending ? "Creating…" : "Create project"}
        </Button>
      </form>
    </Modal>
  );
}
