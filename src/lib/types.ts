export interface Folder {
  id: string;
  parent_id: string | null;
  name: string;
  sort: number;
  updated_at: string; // ISO, set by the device that made the change
  deleted: boolean;
  // local-only bookkeeping
  dirty?: boolean;
  synced_at?: string | null; // updated_at of the last version seen on the server
}

// A version of a note that clashed with another device's version. Kept only on this device until reviewed.
export interface NoteConflict {
  title: string;
  html: string;
  at: string; // when that version was saved
  source: string; // e.g. "this device", "conflict copy"
  auto?: boolean; // merged automatically (old duplicate copies) — shown as a gentle banner, not a stop
}

export interface Note {
  id: string;
  folder_id: string | null;
  title: string;
  html: string; // attachments referenced as pn-att:<id>
  tags: string[];
  sort: number; // custom list order (drag to reorder)
  pinned?: number | null; // pin position: 1 = top. null/undefined = not pinned
  conflicts?: NoteConflict[]; // local only: versions to review (see ConflictView)
  created_at: string;
  updated_at: string;
  deleted: boolean;
  dirty?: boolean;
  synced_at?: string | null;
}

export interface AttachmentMeta {
  id: string;
  note_id: string | null;
  name: string;
  mime: string;
  size: number;
  created_at: string;
  updated_at: string;
  deleted: boolean;
  dirty?: boolean;
  synced_at?: string | null;
  has_blob?: boolean; // blob is stored on this device
}

export type Kind = 'folders' | 'notes' | 'attachments';

export interface PnBundle {
  format: 'permanotes';
  version: 1;
  kind: 'note' | 'folder' | 'library';
  exported_at: string;
  app_version: string;
  folders: Folder[];
  notes: Note[];
  attachments: AttachmentMeta[];
}
