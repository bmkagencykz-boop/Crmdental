import type { Db } from "./types";

const tags = [
  { id: 0, name: "VIP", color: "#ffe7c2" },
  { id: 1, name: "Рассрочка", color: "#dbe4f5" },
  { id: 2, name: "Повторный", color: "#dcefe4" },
  { id: 3, name: "Страховка", color: "#e4e1f3" },
  { id: 4, name: "Ребёнок", color: "#fde0df" },
  { id: 5, name: "Боится боли", color: "#f3e2d6" },
];

export const generateTags = (_: Db) => {
  return [...tags];
};
