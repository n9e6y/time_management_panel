// Plain words for the backend's title issue codes (SYNTAX_SPEC.md §5), with an example fix.
export const ISSUE_INFO: Record<string, { label: string; fix: string }> = {
  missing_category: { label: "No category", fix: "Start the title with a category: `ME: lunch`." },
  tokens_before_category: { label: "Tags before the category", fix: "Move tags after it: `LEARN: x #deep`." },
  legacy_category: { label: "Old category", fix: "Rename it to a current category, or keep it as history." },
  unknown_category: { label: "Category not in your list", fix: "Fix the spelling, or add it in Settings." },
  invalid_score: { label: "Score is not 1-5", fix: "Use one digit from 1 to 5: `[4]`." },
  multiple_scores: { label: "More than one score", fix: "Keep a single `[n]`." },
  empty_task: { label: "Nothing after the category", fix: "Add what you did: `LEARN: calculus`." },
  unknown_tag: { label: "Tag not in your list", fix: "Fix the spelling, or add it to known tags in Settings." },
};

export const SKIP_REASON: Record<string, string> = {
  all_day: "All-day event (not a time block)",
  cancelled: "Cancelled",
  no_end: "No end time",
  non_positive_duration: "Ends before it starts",
};
