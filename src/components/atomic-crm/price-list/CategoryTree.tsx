import { useNotify, useTranslate } from "ra-core";
import { useState, type ReactNode } from "react";
import { Confirm } from "@/components/admin/confirm";
import { cn } from "@/lib/utils";

import { moveItem } from "../settings/useDictionaryMutations";
import { GLYPHS } from "./glyphs";
import { RoundIcon } from "./PriceCells";
import {
  buildCategoryTree,
  categoryNameTaken,
  cleanCategoryName,
  type CategoryFilter,
  type CategoryNode,
} from "./priceListMath";
import type { PriceListRow, ServiceCategory } from "./types";
import { usePriceListWrites } from "./usePriceList";

const same = (a: CategoryFilter, b: CategoryFilter) => String(a) === String(b);

/**
 * The tree of the price list: «Все услуги», the sections with their
 * subsections (counts of the services shown), «Без раздела». Editors add,
 * rename, reorder and delete sections and subsections in place.
 */
export const CategoryTree = ({
  categories,
  rows,
  selected,
  onSelect,
  canEdit,
}: {
  categories: ServiceCategory[];
  rows: PriceListRow[];
  selected: CategoryFilter;
  onSelect: (value: CategoryFilter) => void;
  canEdit: boolean;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const writes = usePriceListWrites();
  const tree = buildCategoryTree(categories, rows);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CategoryNode | null>(null);
  const withoutCategory = rows.filter((row) => row.category_id == null).length;

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const move = (siblings: CategoryNode[], node: CategoryNode, dir: -1 | 1) => {
    for (const [category, position] of moveItem(siblings, node.id, dir)) {
      void writes.updateCategory(category, { position });
    }
  };

  const add = async (parent: CategoryNode | null, raw: string) => {
    const name = cleanCategoryName(raw);
    setAdding(null);
    if (!name) return;
    if (categoryNameTaken(categories, parent?.id ?? null, name)) {
      notify("price_list.tree.name_taken", { type: "warning" });
      return;
    }
    const siblings = parent ? parent.children : tree;
    await writes.createCategory({
      parent_id: parent?.id ?? null,
      name,
      position: siblings.reduce((max, c) => Math.max(max, c.position), -1) + 1,
    });
    if (parent) {
      setCollapsed((current) => {
        const next = new Set(current);
        next.delete(String(parent.id));
        return next;
      });
    }
  };

  const rename = (node: CategoryNode, raw: string) => {
    setEditing(null);
    const name = cleanCategoryName(raw);
    if (!name || name === node.name) return;
    if (categoryNameTaken(categories, node.parent_id, name, node.id)) {
      notify("price_list.tree.name_taken", { type: "warning" });
      return;
    }
    void writes.updateCategory(node, { name });
  };

  const renderNode = (
    node: CategoryNode,
    siblings: CategoryNode[],
    index: number,
    depth: 0 | 1,
  ) => {
    const id = String(node.id);
    const open = !collapsed.has(id);
    return (
      <li key={id}>
        {editing === id ? (
          <NameInput
            initial={node.name}
            label={translate("price_list.tree.rename", { name: node.name })}
            onDone={(value) => rename(node, value)}
            depth={depth}
          />
        ) : (
          <TreeRow
            label={node.name}
            count={node.total}
            active={same(selected, node.id)}
            depth={depth}
            onClick={() => onSelect(node.id)}
            toggle={
              depth === 0 && node.children.length ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle(id);
                  }}
                  aria-label={translate(
                    open
                      ? "price_list.tree.collapse"
                      : "price_list.tree.expand",
                    { name: node.name },
                  )}
                  aria-expanded={open}
                  className="flex size-5 items-center justify-center rounded-full"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className={cn(
                      "size-3 transition-transform",
                      open ? "rotate-90" : "",
                    )}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden="true"
                  >
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
              ) : null
            }
            tools={
              canEdit ? (
                <>
                  <RoundIcon
                    label={translate("price_list.tree.move_up", {
                      name: node.name,
                    })}
                    disabled={index === 0}
                    onClick={() => move(siblings, node, -1)}
                  >
                    {GLYPHS.up}
                  </RoundIcon>
                  <RoundIcon
                    label={translate("price_list.tree.move_down", {
                      name: node.name,
                    })}
                    disabled={index === siblings.length - 1}
                    onClick={() => move(siblings, node, 1)}
                  >
                    {GLYPHS.down}
                  </RoundIcon>
                  {depth === 0 ? (
                    <RoundIcon
                      label={translate("price_list.tree.add_subsection", {
                        name: node.name,
                      })}
                      onClick={() => setAdding(id)}
                    >
                      {GLYPHS.plus}
                    </RoundIcon>
                  ) : null}
                  <RoundIcon
                    label={translate("price_list.tree.rename", {
                      name: node.name,
                    })}
                    onClick={() => setEditing(id)}
                  >
                    {GLYPHS.edit}
                  </RoundIcon>
                  <RoundIcon
                    label={translate("price_list.tree.delete", {
                      name: node.name,
                    })}
                    onClick={() => setDeleting(node)}
                    className="hover:text-tone-red"
                  >
                    {GLYPHS.close}
                  </RoundIcon>
                </>
              ) : null
            }
          />
        )}
        {depth === 0 && (open || adding === id) ? (
          <ul className="flex flex-col gap-0.5">
            {open
              ? node.children.map((child, childIndex) =>
                  renderNode(child, node.children, childIndex, 1),
                )
              : null}
            {adding === id ? (
              <li>
                <NameInput
                  initial=""
                  label={translate("price_list.tree.new_subsection")}
                  placeholder={translate("price_list.tree.new_subsection")}
                  onDone={(value) => void add(node, value)}
                  depth={1}
                />
              </li>
            ) : null}
          </ul>
        ) : null}
      </li>
    );
  };

  return (
    <nav
      className="flex flex-col gap-1"
      aria-label={translate("price_list.tree.label")}
    >
      <ul className="flex flex-col gap-0.5">
        <li>
          <TreeRow
            label={translate("price_list.tree.all")}
            count={rows.length}
            active={selected === "all"}
            depth={0}
            onClick={() => onSelect("all")}
          />
        </li>
        {tree.map((node, index) => renderNode(node, tree, index, 0))}
        {withoutCategory > 0 || selected === "none" ? (
          <li>
            <TreeRow
              label={translate("price_list.tree.none")}
              count={withoutCategory}
              active={selected === "none"}
              depth={0}
              muted
              onClick={() => onSelect("none")}
            />
          </li>
        ) : null}
      </ul>
      {canEdit ? (
        adding === "root" ? (
          <NameInput
            initial=""
            label={translate("price_list.tree.new_section")}
            placeholder={translate("price_list.tree.new_section")}
            onDone={(value) => void add(null, value)}
            depth={0}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding("root")}
            className="mt-2 flex h-10 items-center gap-2 rounded-full bg-pill px-4 text-[13px] font-medium text-foreground transition-colors hover:bg-white"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              aria-hidden="true"
            >
              {GLYPHS.plus}
            </svg>
            {translate("price_list.tree.add_section")}
          </button>
        )
      ) : null}
      <Confirm
        isOpen={deleting != null}
        title={translate("price_list.tree.delete_title", {
          name: deleting?.name ?? "",
        })}
        content={translate(
          deleting?.parent_id == null
            ? "price_list.tree.delete_section_content"
            : "price_list.tree.delete_subsection_content",
          { count: deleting?.total ?? 0 },
        )}
        confirm="ra.action.delete"
        confirmColor="warning"
        onConfirm={() => {
          if (deleting) {
            const node = deleting;
            if (same(selected, node.id)) onSelect("all");
            void writes.deleteCategory(node);
          }
          setDeleting(null);
        }}
        onClose={() => setDeleting(null)}
      />
    </nav>
  );
};

const TreeRow = ({
  label,
  count,
  active,
  depth,
  onClick,
  toggle,
  tools,
  muted,
}: {
  label: string;
  count: number;
  active: boolean;
  depth: 0 | 1;
  onClick: () => void;
  toggle?: ReactNode;
  tools?: ReactNode;
  muted?: boolean;
}) => (
  <div
    className={cn(
      "group flex min-h-10 items-center gap-1 rounded-full pr-1.5 transition-colors",
      depth === 0 ? "pl-2" : "ml-6 pl-3",
      active ? "bg-primary text-primary-foreground" : "hover:bg-pill",
    )}
  >
    <span className="flex w-5 shrink-0 justify-center">{toggle}</span>
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex min-w-0 flex-1 items-center gap-2 py-2 text-left",
        depth === 0 ? "text-[14px] font-medium" : "text-[13px]",
        muted && !active && "text-muted-foreground",
      )}
    >
      <span className="truncate">{label}</span>
      <span
        className={cn(
          "ml-auto shrink-0 text-xs tabular-nums",
          active ? "text-primary-foreground/70" : "text-muted-foreground",
        )}
      >
        {count}
      </span>
    </button>
    {tools ? (
      <span
        className={cn(
          "hidden shrink-0 items-center group-focus-within:flex group-hover:flex",
          active && "[&_button]:text-primary-foreground/80",
        )}
      >
        {tools}
      </span>
    ) : null}
  </div>
);

const NameInput = ({
  initial,
  label,
  placeholder,
  onDone,
  depth,
}: {
  initial: string;
  label: string;
  placeholder?: string;
  onDone: (value: string) => void;
  depth: 0 | 1;
}) => (
  <input
    autoFocus
    defaultValue={initial}
    aria-label={label}
    placeholder={placeholder}
    maxLength={100}
    onBlur={(event) => onDone(event.target.value)}
    onKeyDown={(event) => {
      if (event.key === "Enter") event.currentTarget.blur();
      if (event.key === "Escape") {
        event.currentTarget.value = initial;
        event.currentTarget.blur();
      }
    }}
    className={cn(
      "h-10 w-full rounded-full border border-ring bg-pill px-4 text-[13px] outline-none",
      depth === 1 && "ml-6 w-[calc(100%-1.5rem)]",
    )}
  />
);
