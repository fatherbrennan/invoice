CREATE TABLE profile (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    json TEXT NOT NULL CHECK (json_valid(json))
);

CREATE TABLE customers (
    id TEXT PRIMARY KEY NOT NULL,
    code TEXT NOT NULL UNIQUE,
    next_number INTEGER NOT NULL CHECK (next_number BETWEEN 1 AND 4294967295),
    json TEXT NOT NULL CHECK (json_valid(json))
);

CREATE TABLE drafts (
    id TEXT PRIMARY KEY NOT NULL,
    customer_id TEXT REFERENCES customers(id),
    json TEXT NOT NULL CHECK (json_valid(json))
);

CREATE TABLE issued (
    id TEXT PRIMARY KEY NOT NULL,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    number TEXT NOT NULL UNIQUE,
    snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
    pdf BLOB NOT NULL,
    paid INTEGER NOT NULL CHECK (paid IN (0, 1)),
    void_reason TEXT NOT NULL DEFAULT ''
);

CREATE TRIGGER issued_content_immutable BEFORE UPDATE OF id,customer_id,number,snapshot,pdf ON issued
BEGIN SELECT RAISE(ABORT, 'Issued invoice data and PDF are immutable'); END;
CREATE TABLE invoice_index (
 id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, customer_id TEXT NOT NULL,
 number TEXT NOT NULL, customer_name TEXT NOT NULL, date TEXT NOT NULL,
 total INTEGER, paid INTEGER NOT NULL, description TEXT NOT NULL, body TEXT NOT NULL
);
CREATE INDEX invoice_date ON invoice_index(date DESC,id);
CREATE INDEX invoice_status_date ON invoice_index(kind,paid,date DESC,id);
CREATE INDEX invoice_kind_date ON invoice_index(kind,date DESC,id);
CREATE INDEX invoice_customer ON invoice_index(customer_id,kind);
CREATE VIRTUAL TABLE invoices_fts USING fts5(body, content='invoice_index', content_rowid='rowid', prefix='2 3 4');
CREATE TRIGGER invoice_index_ai AFTER INSERT ON invoice_index BEGIN
 INSERT INTO invoices_fts(rowid,body) VALUES(new.rowid,new.body); END;
CREATE TRIGGER invoice_index_ad AFTER DELETE ON invoice_index BEGIN
 INSERT INTO invoices_fts(invoices_fts,rowid,body) VALUES('delete',old.rowid,old.body); END;
CREATE TRIGGER invoice_index_au AFTER UPDATE ON invoice_index BEGIN
 INSERT INTO invoices_fts(invoices_fts,rowid,body) VALUES('delete',old.rowid,old.body);
 INSERT INTO invoices_fts(rowid,body) VALUES(new.rowid,new.body); END;
CREATE VIRTUAL TABLE customers_fts USING fts5(body, prefix='2 3 4');
CREATE TRIGGER customers_search_ai AFTER INSERT ON customers BEGIN INSERT INTO customers_fts(rowid,body) VALUES(new.rowid,coalesce(json_extract(new.json,'$.code'),'') || ' ' || coalesce(json_extract(new.json,'$.name'),'') || ' ' || coalesce(json_extract(new.json,'$.abn'),'') || ' ' || coalesce(json_extract(new.json,'$.address'),'')); END;
CREATE TRIGGER customers_search_au AFTER UPDATE ON customers BEGIN DELETE FROM customers_fts WHERE rowid=old.rowid; INSERT INTO customers_fts(rowid,body) VALUES(new.rowid,coalesce(json_extract(new.json,'$.code'),'') || ' ' || coalesce(json_extract(new.json,'$.name'),'') || ' ' || coalesce(json_extract(new.json,'$.abn'),'') || ' ' || coalesce(json_extract(new.json,'$.address'),'')); END;
CREATE TRIGGER customers_search_ad AFTER DELETE ON customers BEGIN DELETE FROM customers_fts WHERE rowid=old.rowid; END;
CREATE TRIGGER issued_index_ai AFTER INSERT ON issued BEGIN DELETE FROM invoice_index WHERE id=new.id; INSERT OR REPLACE INTO invoice_index SELECT i.id,'issued',i.customer_id,i.number,
 coalesce(nullif(json_extract(i.snapshot,'$.customer.name'),''),json_extract(i.snapshot,'$.customer.abn')),
 json_extract(i.snapshot,'$.draft.date'),json_extract(i.snapshot,'$.totals.total'),i.paid,
 coalesce(json_extract(i.snapshot,'$.draft.lines[0].description'),''),
 i.number || ' ' || json_extract(i.snapshot,'$.customer.code') || ' ' || json_extract(i.snapshot,'$.customer.name') || ' ' || json_extract(i.snapshot,'$.customer.abn') || ' ' || json_extract(i.snapshot,'$.draft.notes') || ' ' || coalesce((SELECT group_concat(json_extract(value,'$.description'),' ') FROM json_each(i.snapshot,'$.draft.lines')),'') FROM issued i WHERE i.id=new.id; END;
CREATE TRIGGER issued_index_ad AFTER DELETE ON issued BEGIN DELETE FROM invoice_index WHERE id=old.id; END;
CREATE TRIGGER issued_paid_index AFTER UPDATE OF paid ON issued BEGIN UPDATE invoice_index SET paid=new.paid WHERE id=new.id; END;
CREATE TRIGGER drafts_index_ai AFTER INSERT ON drafts BEGIN INSERT OR REPLACE INTO invoice_index SELECT d.id,'draft',coalesce(d.customer_id,''),'Draft',
 coalesce(nullif(json_extract(c.json,'$.name'),''),nullif(json_extract(c.json,'$.abn'),''),'No customer selected'),
 json_extract(d.json,'$.date'),NULL,0,coalesce(json_extract(d.json,'$.lines[0].description'),''),
 coalesce(c.code,'') || ' ' || coalesce(json_extract(c.json,'$.name'),'') || ' ' || coalesce(json_extract(c.json,'$.abn'),'') || ' ' || json_extract(d.json,'$.notes') || ' ' || coalesce((SELECT group_concat(json_extract(value,'$.description'),' ') FROM json_each(d.json,'$.lines')),'') FROM drafts d LEFT JOIN customers c ON c.id=d.customer_id WHERE d.id=new.id; END;
CREATE TRIGGER drafts_index_ad AFTER DELETE ON drafts BEGIN DELETE FROM invoice_index WHERE id=old.id AND kind='draft'; END;
CREATE TRIGGER drafts_index_au AFTER UPDATE ON drafts BEGIN DELETE FROM invoice_index WHERE id=old.id; INSERT OR REPLACE INTO invoice_index SELECT d.id,'draft',coalesce(d.customer_id,''),'Draft',
 coalesce(nullif(json_extract(c.json,'$.name'),''),nullif(json_extract(c.json,'$.abn'),''),'No customer selected'),
 json_extract(d.json,'$.date'),NULL,0,coalesce(json_extract(d.json,'$.lines[0].description'),''),
 coalesce(c.code,'') || ' ' || coalesce(json_extract(c.json,'$.name'),'') || ' ' || coalesce(json_extract(c.json,'$.abn'),'') || ' ' || json_extract(d.json,'$.notes') || ' ' || coalesce((SELECT group_concat(json_extract(value,'$.description'),' ') FROM json_each(d.json,'$.lines')),'') FROM drafts d LEFT JOIN customers c ON c.id=d.customer_id WHERE d.id=new.id; END;
CREATE TRIGGER customer_drafts_index AFTER UPDATE ON customers WHEN new.code<>old.code OR json_extract(new.json,'$.name')<>json_extract(old.json,'$.name') OR json_extract(new.json,'$.abn')<>json_extract(old.json,'$.abn') BEGIN DELETE FROM invoice_index WHERE kind='draft' AND customer_id=new.id; INSERT OR REPLACE INTO invoice_index SELECT d.id,'draft',coalesce(d.customer_id,''),'Draft',
 coalesce(nullif(json_extract(c.json,'$.name'),''),nullif(json_extract(c.json,'$.abn'),''),'No customer selected'),
 json_extract(d.json,'$.date'),NULL,0,coalesce(json_extract(d.json,'$.lines[0].description'),''),
 coalesce(c.code,'') || ' ' || coalesce(json_extract(c.json,'$.name'),'') || ' ' || coalesce(json_extract(c.json,'$.abn'),'') || ' ' || json_extract(d.json,'$.notes') || ' ' || coalesce((SELECT group_concat(json_extract(value,'$.description'),' ') FROM json_each(d.json,'$.lines')),'') FROM drafts d LEFT JOIN customers c ON c.id=d.customer_id WHERE c.id=new.id; END;

CREATE TABLE services (
 id TEXT PRIMARY KEY NOT NULL,
 json TEXT NOT NULL CHECK(json_valid(json))
);
CREATE INDEX service_name ON services(json_extract(json,'$.name') COLLATE NOCASE,id);
CREATE VIRTUAL TABLE services_fts USING fts5(body, prefix='2 3 4');
CREATE TRIGGER services_search_ai AFTER INSERT ON services BEGIN
 INSERT INTO services_fts(rowid,body) VALUES(new.rowid,json_extract(new.json,'$.name') || ' ' || json_extract(new.json,'$.description')); END;
CREATE TRIGGER services_search_au AFTER UPDATE ON services BEGIN
 DELETE FROM services_fts WHERE rowid=old.rowid;
 INSERT INTO services_fts(rowid,body) VALUES(new.rowid,json_extract(new.json,'$.name') || ' ' || json_extract(new.json,'$.description')); END;
CREATE TRIGGER services_search_ad AFTER DELETE ON services BEGIN DELETE FROM services_fts WHERE rowid=old.rowid; END;
PRAGMA user_version=2;
