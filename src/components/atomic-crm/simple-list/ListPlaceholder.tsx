import { cn } from "@/lib/utils";

interface ListPlaceholderProps {
  className?: string;
}

export const ListPlaceholder = ({ className }: ListPlaceholderProps) => {
  return <span className={cn("bg-muted flex", className)}>&nbsp;</span>;
};
