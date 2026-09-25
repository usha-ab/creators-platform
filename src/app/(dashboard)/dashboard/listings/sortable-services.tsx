"use client";

import { useState, useTransition } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/toaster";
import ListingRow, { type Listing } from "./listing-row";
import { reorderListings } from "./actions";

/**
 * Dra och släpp för tjänster.
 *
 * Pilarna räckte för fem rader men blir tröttsamma vid tjugo, och de säger inte
 * heller att ordningen går att ändra — man måste redan veta det. Ett handtag
 * gör det synligt.
 *
 * Samma mönster som mediagalleriet på profilsidan: dnd-kit fanns redan som
 * beroende, och sensorerna är kopierade därifrån med flit. PointerSensor med
 * 5 px tröskel gör att ett klick på raden fortfarande är ett klick, och
 * TouchSensor med 200 ms fördröjning låter fingret skrolla listan i stället för
 * att varje svep börjar dra.
 *
 * Pilarna finns kvar. De fungerar med tangentbord och skärmläsare, och de är
 * det enda som fungerar om drag skulle fallera på någon enhet.
 */
export function SortableServices({ tjanster }: { tjanster: Listing[] }) {
  const t = useTranslations("listingsPage");
  const { toast } = useToast();
  const [rader, setRader] = useState(tjanster);
  const [, startTransition] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setRader((prev) => {
      const fran = prev.findIndex((l) => l.id === active.id);
      const till = prev.findIndex((l) => l.id === over.id);
      const ny = arrayMove(prev, fran, till);

      // Sparas i bakgrunden. Listan står redan rätt på skärmen; att vänta på
      // servern innan man ser resultatet gör draget klibbigt.
      startTransition(async () => {
        const result = await reorderListings(ny.map((l) => l.id));
        if ("error" in result && result.error) {
          toast.error(result.error);
          setRader(prev); // tillbaka till det som faktiskt gäller
        }
      });

      return ny;
    });
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={rader.map((l) => l.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-3">
          {rader.map((listing, i) => (
            <SorterbarRad
              key={listing.id}
              listing={listing}
              kanFlyttaUpp={i > 0}
              kanFlyttaNer={i < rader.length - 1}
              dragLabel={t("dragHandle")}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SorterbarRad({
  listing,
  kanFlyttaUpp,
  kanFlyttaNer,
  dragLabel,
}: {
  listing: Listing;
  kanFlyttaUpp: boolean;
  kanFlyttaNer: boolean;
  dragLabel: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: listing.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-stretch gap-2 ${isDragging ? "z-10 opacity-60" : ""}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={dragLabel}
        title={dragLabel}
        className="flex w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-[var(--usha-muted)] transition-colors hover:bg-[var(--usha-card-hover)] hover:text-[var(--usha-white)] active:cursor-grabbing"
      >
        <GripVertical size={16} />
      </button>
      <div className="min-w-0 flex-1">
        <ListingRow listing={listing} kanFlyttaUpp={kanFlyttaUpp} kanFlyttaNer={kanFlyttaNer} />
      </div>
    </div>
  );
}
