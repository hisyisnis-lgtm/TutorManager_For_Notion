-- Manage the existing home and Chinese-learning cards without importing their external article bodies.
ALTER TABLE site_content ADD COLUMN thumbnail_url TEXT;
ALTER TABLE site_content ADD COLUMN display_category TEXT NOT NULL DEFAULT '';
ALTER TABLE site_content ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags_json) AND json_type(tags_json)='array');
ALTER TABLE site_content ADD COLUMN show_on_home INTEGER NOT NULL DEFAULT 0 CHECK(show_on_home IN (0,1));
ALTER TABLE site_content ADD COLUMN home_sort_order INTEGER NOT NULL DEFAULT 0 CHECK(home_sort_order BETWEEN -100000 AND 100000);
CREATE INDEX IF NOT EXISTS idx_site_content_home ON site_content(status,category,show_on_home,home_sort_order,slug);

-- EXISTING_CARD_SEED: conflict-safe; never reset a previously edited or hidden card.
INSERT INTO site_content(slug,title,summary,body,category,status,external_url,sort_order,thumbnail_url,display_category,tags_json,show_on_home,home_sort_order,published_at,created_at,updated_at)
VALUES('blog-224100629127','중국어 회화가 안 트이는 진짜 이유 3가지','단어도 문법도 아는데 입이 안 열리는 이유, 그리고 발음·억양부터 잡는 순서.','','learn','published','https://blog.naver.com/tiantian_chinese/224100629127',0,'/img/posts/conversation-start-teacher.webp','회화','["#회화","#발음","#억양"]',1,0,'2026-10-12T00:00:00.000Z','2026-10-12T00:00:00.000Z','2026-10-12T00:00:00.000Z')
ON CONFLICT(slug) DO NOTHING;

INSERT INTO site_content(slug,title,summary,body,category,status,external_url,sort_order,thumbnail_url,display_category,tags_json,show_on_home,home_sort_order,published_at,created_at,updated_at)
VALUES('blog-224102488682','회화가 안 늘 때 나타나는 5가지 공통 신호','"말하기만 하면 막혀요"에 숨어 있는 공통 신호 다섯 가지.','','learn','published','https://blog.naver.com/tiantian_chinese/224102488682',1,'/img/posts/conversation-practice-real-enhanced.webp','회화','["#회화","#자가진단"]',0,0,'2026-10-12T00:00:00.000Z','2026-10-12T00:00:00.000Z','2026-10-12T00:00:00.000Z')
ON CONFLICT(slug) DO NOTHING;

INSERT INTO site_content(slug,title,summary,body,category,status,external_url,sort_order,thumbnail_url,display_category,tags_json,show_on_home,home_sort_order,published_at,created_at,updated_at)
VALUES('blog-224100640037','중국어 발음 교정의 핵심 비법 5가지','발음은 감이 아니라 원리 → 교정 → 반복 → 적용. 수업에서 실제로 쓰는 방법.','','learn','published','https://blog.naver.com/tiantian_chinese/224100640037',2,'/img/posts/pronunciation-tones-teacher.webp','발음','["#발음교정","#성조","#초중급"]',1,1,'2026-10-12T00:00:00.000Z','2026-10-12T00:00:00.000Z','2026-10-12T00:00:00.000Z')
ON CONFLICT(slug) DO NOTHING;

INSERT INTO site_content(slug,title,summary,body,category,status,external_url,sort_order,thumbnail_url,display_category,tags_json,show_on_home,home_sort_order,published_at,created_at,updated_at)
VALUES('blog-224104953708','발음 교정, 언제 시작하는 게 가장 좋을까?','늦지 않을수록 좋지만 지금도 늦지 않은 이유. 방향이 맞는지가 먼저입니다.','','learn','published','https://blog.naver.com/tiantian_chinese/224104953708',3,'/img/posts/pronunciation-start-real-enhanced.webp','발음','["#발음교정","#초급"]',0,0,'2026-10-12T00:00:00.000Z','2026-10-12T00:00:00.000Z','2026-10-12T00:00:00.000Z')
ON CONFLICT(slug) DO NOTHING;

INSERT INTO site_content(slug,title,summary,body,category,status,external_url,sort_order,thumbnail_url,display_category,tags_json,show_on_home,home_sort_order,published_at,created_at,updated_at)
VALUES('blog-224112142712','하루 10분 공부, 왜 말하기는 달라지지 않을까?','가볍게 시작하는 건 좋지만, 입이 트이려면 필요한 것이 따로 있습니다.','','learn','published','https://blog.naver.com/tiantian_chinese/224112142712',4,'/img/posts/daily-study-topic.webp','공부 방식','["#공부습관","#회화"]',1,2,'2026-10-12T00:00:00.000Z','2026-10-12T00:00:00.000Z','2026-10-12T00:00:00.000Z')
ON CONFLICT(slug) DO NOTHING;

INSERT INTO site_content(slug,title,summary,body,category,status,external_url,sort_order,thumbnail_url,display_category,tags_json,show_on_home,home_sort_order,published_at,created_at,updated_at)
VALUES('blog-224256432256','"몰라"하면 不知道밖에 안 떠오르시나요?','한국어 직역 습관에서 벗어나는 자연스러운 한마디들.','','learn','published','https://blog.naver.com/tiantian_chinese/224256432256',5,'/img/posts/natural-expressions-topic.webp','표현','["#표현","#직역습관"]',0,0,'2026-10-12T00:00:00.000Z','2026-10-12T00:00:00.000Z','2026-10-12T00:00:00.000Z')
ON CONFLICT(slug) DO NOTHING;

INSERT INTO site_content(slug,title,summary,body,category,status,external_url,sort_order,thumbnail_url,display_category,tags_json,show_on_home,home_sort_order,published_at,created_at,updated_at)
VALUES('blog-224186472283','춘절에 꼭 알아야 할 단어 5가지','春节快乐! 중국 최대 명절에 정말 많이 들리는 인사와 단어.','','learn','published','https://blog.naver.com/tiantian_chinese/224186472283',6,'/img/posts/spring-festival-topic.webp','문화 · 표현','["#춘절","#문화","#표현"]',0,0,'2026-10-12T00:00:00.000Z','2026-10-12T00:00:00.000Z','2026-10-12T00:00:00.000Z')
ON CONFLICT(slug) DO NOTHING;

INSERT INTO site_content(slug,title,summary,body,category,status,external_url,sort_order,thumbnail_url,display_category,tags_json,show_on_home,home_sort_order,published_at,created_at,updated_at)
VALUES('blog-224165667634','휴대폰·이어폰 액세서리, 중국어로 뭐라고 할까?','수업에서 나온 질문으로 배우는 생활 단어.','','learn','published','https://blog.naver.com/tiantian_chinese/224165667634',7,'/img/posts/phone-accessories-topic.webp','표현','["#생활단어","#표현"]',0,0,'2026-10-12T00:00:00.000Z','2026-10-12T00:00:00.000Z','2026-10-12T00:00:00.000Z')
ON CONFLICT(slug) DO NOTHING;
