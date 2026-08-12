export type MemoryKind = "preference" | "fact" | "task_state";
export type MessageRole = "user" | "assistant" | "system";
export type DedupeAction = "ADD" | "UPDATE" | "SKIP";
export type MemoryLinkRel = "supersedes" | "duplicates" | "derived_from";

export type Memory = {
  id: string;
  user_id: string;
  kind: MemoryKind;
  content: string;
  importance: number;
  hit_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  source_message_id: string | null;
  source_thread_id: string | null;
};

export type HybridHit = Memory & {
  score_vec: number;
  score_txt: number;
  score_recency: number;
  score_usage: number;
  hybrid_score: number;
};

export type Thread = {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type Message = {
  id: string;
  thread_id: string;
  user_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
};

export type MemoryCandidate = {
  kind: MemoryKind;
  content: string;
  importance?: number;
};
