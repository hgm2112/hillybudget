"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronDown } from "lucide-react";
import { monthLabel, shiftMonth } from "@/lib/month";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function MonthNav({
  value,
  months,
  onSelect,
}: {
  value: string;
  months: string[];
  onSelect: (month: string) => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>('[data-slot="dropdown-menu-content"] [data-current-month]')
        ?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" aria-label="Previous month" onClick={() => onSelect(shiftMonth(value, -1))}>
        <ArrowLeft className="size-4" />
      </Button>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          render={<Button variant="outline" className="min-w-40 justify-center gap-1 tabular-nums" />}
        >
          {monthLabel(value)}
          <ChevronDown className="size-4 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72">
          {months.map((month) => {
            const isCurrent = month === value;
            return (
              <DropdownMenuItem
                key={month}
                data-current-month={isCurrent ? "true" : undefined}
                className={isCurrent ? "font-semibold tabular-nums" : "tabular-nums"}
                onClick={() => onSelect(month)}
              >
                {monthLabel(month)}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="outline" aria-label="Next month" onClick={() => onSelect(shiftMonth(value, 1))}>
        <ArrowRight className="size-4" />
      </Button>
    </div>
  );
}
