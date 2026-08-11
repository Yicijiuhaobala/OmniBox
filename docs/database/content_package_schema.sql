-- OmniBox Learning Center read-only content package database
-- A distributed package is opened read-only after manifest and checksum validation.
-- User progress never has a database foreign key to these tables.

PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

CREATE TABLE content_package (
    package_id TEXT PRIMARY KEY,
    package_version TEXT NOT NULL,
    schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
    title TEXT NOT NULL,
    locale TEXT NOT NULL,
    publisher TEXT NOT NULL,
    license_text TEXT NOT NULL,
    minimum_app_version TEXT NOT NULL,
    manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json)),
    content_sha256 TEXT NOT NULL,
    signature TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE learning_tracks (
    id TEXT PRIMARY KEY,
    domain TEXT NOT NULL CHECK (domain IN ('english', 'fund', 'llm', 'common')),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    difficulty TEXT,
    version TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json))
);

CREATE TABLE course_modules (
    id TEXT PRIMARY KEY,
    track_id TEXT NOT NULL REFERENCES learning_tracks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    order_index INTEGER NOT NULL,
    estimated_minutes INTEGER CHECK (estimated_minutes IS NULL OR estimated_minutes > 0),
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
    UNIQUE (track_id, order_index)
);

CREATE TABLE module_prerequisites (
    module_id TEXT NOT NULL REFERENCES course_modules(id) ON DELETE CASCADE,
    prerequisite_module_id TEXT NOT NULL REFERENCES course_modules(id) ON DELETE RESTRICT,
    requirement_type TEXT NOT NULL DEFAULT 'required'
        CHECK (requirement_type IN ('required', 'recommended')),
    PRIMARY KEY (module_id, prerequisite_module_id),
    CHECK (module_id <> prerequisite_module_id)
);

CREATE TABLE lessons (
    id TEXT PRIMARY KEY,
    module_id TEXT NOT NULL REFERENCES course_modules(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    content_path TEXT NOT NULL,
    content_sha256 TEXT NOT NULL,
    estimated_minutes INTEGER NOT NULL CHECK (estimated_minutes > 0),
    order_index INTEGER NOT NULL,
    requirement_flags_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(requirement_flags_json)),
    version TEXT NOT NULL,
    UNIQUE (module_id, order_index)
);

CREATE TABLE concepts (
    id TEXT PRIMARY KEY,
    domain TEXT NOT NULL CHECK (domain IN ('english', 'fund', 'llm', 'common')),
    name TEXT NOT NULL,
    definition TEXT NOT NULL,
    difficulty TEXT,
    version TEXT NOT NULL,
    aliases_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(aliases_json)),
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json))
);

CREATE TABLE concept_prerequisites (
    concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    prerequisite_concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE RESTRICT,
    requirement_type TEXT NOT NULL DEFAULT 'required'
        CHECK (requirement_type IN ('required', 'recommended')),
    PRIMARY KEY (concept_id, prerequisite_concept_id),
    CHECK (concept_id <> prerequisite_concept_id)
);

CREATE TABLE lesson_concepts (
    lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE RESTRICT,
    role TEXT NOT NULL CHECK (role IN ('primary', 'supporting', 'prerequisite')),
    PRIMARY KEY (lesson_id, concept_id)
);

CREATE INDEX idx_lesson_concepts_concept
    ON lesson_concepts(concept_id, lesson_id);

CREATE TABLE exercises (
    id TEXT PRIMARY KEY,
    lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    type TEXT NOT NULL
        CHECK (type IN ('choice', 'text', 'calculation', 'dictation', 'speech', 'code', 'case', 'project')),
    title TEXT,
    prompt_json TEXT NOT NULL CHECK (json_valid(prompt_json)),
    rubric_json TEXT NOT NULL CHECK (json_valid(rubric_json)),
    answer_json TEXT CHECK (answer_json IS NULL OR json_valid(answer_json)),
    ai_required INTEGER NOT NULL DEFAULT 0 CHECK (ai_required IN (0, 1)),
    estimated_minutes INTEGER CHECK (estimated_minutes IS NULL OR estimated_minutes > 0),
    order_index INTEGER NOT NULL,
    version TEXT NOT NULL,
    UNIQUE (lesson_id, order_index)
);

CREATE TABLE exercise_concepts (
    exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE RESTRICT,
    role TEXT NOT NULL DEFAULT 'primary'
        CHECK (role IN ('primary', 'supporting', 'prerequisite')),
    weight REAL NOT NULL DEFAULT 1.0 CHECK (weight >= 0.0 AND weight <= 1.0),
    PRIMARY KEY (exercise_id, concept_id)
);

CREATE TABLE review_templates (
    id TEXT PRIMARY KEY,
    concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    card_type TEXT NOT NULL,
    front_json TEXT NOT NULL CHECK (json_valid(front_json)),
    back_json TEXT NOT NULL CHECK (json_valid(back_json)),
    generation_rules_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(generation_rules_json)),
    version TEXT NOT NULL
);

CREATE TABLE fund_cases (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    scenario_json TEXT NOT NULL CHECK (json_valid(scenario_json)),
    material_refs_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(material_refs_json)),
    rubric_json TEXT NOT NULL CHECK (json_valid(rubric_json)),
    risk_labels_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(risk_labels_json)),
    market_scope TEXT NOT NULL,
    data_as_of TEXT,
    version TEXT NOT NULL
);

CREATE TABLE fund_case_concepts (
    case_id TEXT NOT NULL REFERENCES fund_cases(id) ON DELETE CASCADE,
    concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE RESTRICT,
    PRIMARY KEY (case_id, concept_id)
);

CREATE TABLE lab_definitions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    track_type TEXT NOT NULL CHECK (track_type IN ('application', 'algorithm', 'common')),
    runtime_type TEXT NOT NULL CHECK (runtime_type IN ('embedded', 'local_project', 'external')),
    parameters_schema_json TEXT NOT NULL CHECK (json_valid(parameters_schema_json)),
    environment_requirements_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(environment_requirements_json)),
    starter_assets_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(starter_assets_json)),
    rubric_json TEXT NOT NULL CHECK (json_valid(rubric_json)),
    version TEXT NOT NULL
);

CREATE TABLE lab_concepts (
    lab_id TEXT NOT NULL REFERENCES lab_definitions(id) ON DELETE CASCADE,
    concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE RESTRICT,
    role TEXT NOT NULL DEFAULT 'primary'
        CHECK (role IN ('primary', 'supporting', 'prerequisite')),
    PRIMARY KEY (lab_id, concept_id)
);

CREATE TABLE content_aliases (
    old_ref TEXT PRIMARY KEY,
    new_ref TEXT NOT NULL,
    reason TEXT NOT NULL,
    introduced_in_version TEXT NOT NULL
);

CREATE INDEX idx_course_modules_track_order
    ON course_modules(track_id, order_index);

CREATE INDEX idx_lessons_module_order
    ON lessons(module_id, order_index);

COMMIT;
