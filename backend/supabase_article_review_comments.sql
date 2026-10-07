create table if not exists article_review_comments (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references articles(id) on delete cascade,
  manager_id uuid references users(id) on delete set null,
  review_round integer not null default 1,
  anchor_field text not null default 'long_description',
  anchor_start integer not null,
  anchor_length integer not null,
  selected_text text not null,
  prefix_text text,
  suffix_text text,
  comment_text text not null,
  display_order integer not null default 1,
  status text not null default 'open' check (status in ('open', 'addressed', 'resolved')),
  writer_addressed_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists article_review_comments_article_idx
  on article_review_comments(article_id, review_round, display_order);
create index if not exists article_review_comments_status_idx
  on article_review_comments(article_id, status);
