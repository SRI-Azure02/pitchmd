import axios from 'axios';

const DB = 'CORTEX_TESTING.PUBLIC';

interface SnowflakeQueryOptions {
  database?: string;
  schema?: string;
  warehouse?: string;
}

export class SnowflakeClient {
  private account: string;
  private warehouse: string;
  private pat: string;
  private role: string;

  constructor() {
    this.account = process.env.SNOWFLAKE_ACCOUNT || '';
    this.warehouse = process.env.SNOWFLAKE_WAREHOUSE || '';
    this.pat =
      process.env.SNOWFLAKE_PAT ||
      process.env.SNOWFLAKE_PASSWORD ||
      '';
    // Optional: override the session role used for procedure execution.
    // Set SNOWFLAKE_ROLE in .env.local to a role that has EXECUTE on ML.REPEVAL.
    this.role = process.env.SNOWFLAKE_ROLE || '';

    if (!this.account || !this.warehouse || !this.pat) {
      throw new Error(
        'Missing required Snowflake env vars: SNOWFLAKE_ACCOUNT, SNOWFLAKE_WAREHOUSE, SNOWFLAKE_PAT'
      );
    }
  }

  private get baseURL(): string {
    return `https://${this.account}.snowflakecomputing.com/api/v2`;
  }

  private get headers() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.pat}`,
    };
  }

  private parseResponse(responseData: any): any[] {
    const rows = responseData.data;
    const rowType = responseData.resultSetMetaData?.rowType;

    if (!rows || !rowType) return [];

    return rows.map((row: any[]) => {
      const obj: Record<string, any> = {};
      rowType.forEach((col: any, i: number) => {
        obj[col.name] = row[i];
      });
      return obj;
    });
  }

  async executeQuery(
    sql: string,
    bindings?: Record<string, { type: string; value: string }>,
    options: SnowflakeQueryOptions = {}
  ): Promise<any[]> {
    const body: Record<string, any> = {
      statement: sql,
      database: options.database || 'CORTEX_TESTING',
      schema: options.schema || 'PUBLIC',
      warehouse: options.warehouse || this.warehouse,
    };
    if (bindings) body.bindings = bindings;

    const response = await axios.post(
      `${this.baseURL}/statements`,
      body,
      { headers: this.headers }
    );

    if (response.data?.code === '090001' && response.data?.data) {
      return this.parseResponse(response.data);
    }

    const statementId = response.data.statementHandle;
    if (!statementId) {
      throw new Error('No statementHandle returned from Snowflake');
    }

    return await this.pollForResults(statementId);
  }

  /**
   * Call CORTEX_TESTING.ML.REPEVAL directly.
   * REPEVAL runs EVALUATE_SALES_REP (Claude 3.5 Sonnet via Snowflake Cortex)
   * which takes 60–120s, so we poll for up to 5 minutes.
   */
  async callRepEval(
    physicianId: string,
    transcript: string,
    appUserId: string,
  ): Promise<void> {
    // Use schema-qualified name only (ML.REPEVAL), not fully qualified.
    // The database/schema context is passed in the request body so Snowflake
    // resolves ML.REPEVAL within CORTEX_TESTING — matching how the Cortex
    // Agent calls it: CALL ML.REPEVAL(...)
    const sql = `CALL ML.REPEVAL(:1, :2, :3)`;
    const bindings = {
      '1': { type: 'TEXT', value: physicianId },
      '2': { type: 'TEXT', value: transcript },
      '3': { type: 'TEXT', value: appUserId },
    };

    const body: Record<string, any> = {
      statement: sql,
      database: 'CORTEX_TESTING',
      schema: 'ML',
      warehouse: this.warehouse,
      bindings,
    };
    if (this.role) body.role = this.role;

    console.log(`[snowflake] callRepEval — physician=${physicianId}, user=${appUserId}, role=${this.role || '(default)'}, transcriptLen=${transcript.length}`);

    let response: any;
    try {
      response = await axios.post(
        `${this.baseURL}/statements`,
        body,
        { headers: this.headers },
      );
    } catch (err: any) {
      const status = err?.response?.status;
      const data = err?.response?.data;
      console.error(`[snowflake] callRepEval initial POST failed — status=${status}`, JSON.stringify(data));
      throw err;
    }

    console.log(`[snowflake] callRepEval initial response — code=${response.data?.code}, statementHandle=${response.data?.statementHandle}`);

    if (response.data?.code === '090001') {
      console.log('[snowflake] callRepEval completed synchronously');
      return;
    }

    const statementId = response.data.statementHandle;
    if (!statementId) {
      console.error('[snowflake] callRepEval — no statementHandle, full response:', JSON.stringify(response.data));
      throw new Error('No statementHandle returned from Snowflake for REPEVAL');
    }

    console.log(`[snowflake] callRepEval polling for statementId=${statementId}`);
    // Poll up to 5 minutes (300 × 1s)
    await this.pollForResults(statementId, 300, 1000);
    console.log(`[snowflake] callRepEval completed — statementId=${statementId}`);
  }

  private async pollForResults(
    statementId: string,
    maxAttempts = 60,
    delayMs = 500
  ): Promise<any[]> {
    for (let i = 0; i < maxAttempts; i++) {
      const response = await axios.get(
        `${this.baseURL}/statements/${statementId}`,
        { headers: this.headers }
      );

      const { code, data, message } = response.data;

      if (code === '090001' && data) {
        return this.parseResponse(response.data);
      }

      if (code === '000604') {
        throw new Error(message || 'Query execution failed');
      }

      await new Promise((r) => setTimeout(r, delayMs));
    }

    throw new Error('Query execution timeout');
  }

  // ─── Auth Queries ────────────────────────────────────────────────────

  async getUserByUsername(username: string): Promise<any> {
    const sql = `
      SELECT USER_ID, USERNAME, EMAIL, PASSWORD_HASH
      FROM CORTEX_TESTING.PUBLIC.USERS
      WHERE USERNAME = ?
      LIMIT 1
    `;
    const results = await this.executeQuery(sql, {
      '1': { type: 'TEXT', value: username },
    });
    return results?.[0] ?? null;
  }

  // ─── Physician Queries ───────────────────────────────────────────────

  async queryAllPhysicians(): Promise<any[]> {
    const sql = `
      SELECT
        pc.PHYSICIAN_ID,
        pc.PHYSICIAN_FIRST_NAME     AS FIRST_NAME,
        pc.PHYSICIAN_LAST_NAME      AS LAST_NAME,
        pc.PHYSICIAN_SPECIALTY      AS SPECIALTY,
        pc.PHYSICIAN_CITY           AS CITY,
        pc.PHYSICIAN_STATE          AS STATE,
        pc.VOICE_MODEL,
        ps.SEGMENT_NAME,
        ps.ATTITUDINAL_DESCRIPTION
      FROM CORTEX_TESTING.PUBLIC.SYNTHETIC_PHYSICIAN_CHARS pc
      LEFT JOIN CORTEX_TESTING.PUBLIC.SYNTHETIC_PHYSICIAN_SEGMENT ps
        ON pc.PHYSICIAN_ID = ps.PHYSICIAN_ID
      ORDER BY pc.PHYSICIAN_LAST_NAME, pc.PHYSICIAN_FIRST_NAME ASC
    `;
    return await this.executeQuery(sql);
  }

  /**
   * Like queryAllPhysicians but computes each physician's OVERALL_SCORE as the
   * median and FIELD_READINESS as the mode across the rep's most recent 3
   * evaluation sessions with that physician.
   */
  async queryAllPhysiciansWithScores(appUserId: string): Promise<any[]> {
    const sql = `
      WITH last3 AS (
        SELECT
          PHYSICIAN_ID,
          OVERALL_SCORE,
          FIELD_READINESS,
          ROW_NUMBER() OVER (PARTITION BY PHYSICIAN_ID ORDER BY EVALUATED_AT DESC) AS rn
        FROM CORTEX_TESTING.ML.REPEVAL_RESULTS
        WHERE APP_USER_ID = :1
      ),
      median_scores AS (
        SELECT PHYSICIAN_ID, MEDIAN(OVERALL_SCORE) AS OVERALL_SCORE
        FROM last3
        WHERE rn <= 3
        GROUP BY PHYSICIAN_ID
      ),
      readiness_counts AS (
        SELECT PHYSICIAN_ID, FIELD_READINESS, COUNT(*) AS cnt
        FROM last3
        WHERE rn <= 3 AND FIELD_READINESS IS NOT NULL
        GROUP BY PHYSICIAN_ID, FIELD_READINESS
      ),
      mode_readiness AS (
        SELECT PHYSICIAN_ID, FIELD_READINESS
        FROM (
          SELECT
            PHYSICIAN_ID,
            FIELD_READINESS,
            ROW_NUMBER() OVER (
              PARTITION BY PHYSICIAN_ID
              ORDER BY cnt DESC, FIELD_READINESS
            ) AS mode_rn
          FROM readiness_counts
        )
        WHERE mode_rn = 1
      )
      SELECT
        pc.PHYSICIAN_ID,
        pc.PHYSICIAN_FIRST_NAME     AS FIRST_NAME,
        pc.PHYSICIAN_LAST_NAME      AS LAST_NAME,
        pc.PHYSICIAN_SPECIALTY      AS SPECIALTY,
        pc.PHYSICIAN_CITY           AS CITY,
        pc.PHYSICIAN_STATE          AS STATE,
        pc.VOICE_MODEL,
        ps.SEGMENT_NAME,
        ps.ATTITUDINAL_DESCRIPTION,
        ms.OVERALL_SCORE,
        mr.FIELD_READINESS
      FROM CORTEX_TESTING.PUBLIC.SYNTHETIC_PHYSICIAN_CHARS pc
      LEFT JOIN CORTEX_TESTING.PUBLIC.SYNTHETIC_PHYSICIAN_SEGMENT ps
        ON pc.PHYSICIAN_ID = ps.PHYSICIAN_ID
      LEFT JOIN median_scores ms   ON pc.PHYSICIAN_ID = ms.PHYSICIAN_ID
      LEFT JOIN mode_readiness mr  ON pc.PHYSICIAN_ID = mr.PHYSICIAN_ID
      ORDER BY pc.PHYSICIAN_LAST_NAME, pc.PHYSICIAN_FIRST_NAME ASC
    `;
    return await this.executeQuery(sql, {
      '1': { type: 'TEXT', value: appUserId },
    });
  }

  /**
   * Look up a physician's ID by their ElevenLabs voice model ID.
   * Queries SYNTHETIC_PHYSICIAN_CHARS which is confirmed to exist.
   */
  async getPhysicianByVoiceModel(voiceModel: string): Promise<string | null> {
    const sql = `
      SELECT PHYSICIAN_ID
      FROM CORTEX_TESTING.PUBLIC.SYNTHETIC_PHYSICIAN_CHARS
      WHERE VOICE_MODEL = ?
      LIMIT 1
    `;
    const results = await this.executeQuery(sql, {
      '1': { type: 'TEXT', value: voiceModel },
    });
    return results?.[0]?.PHYSICIAN_ID ?? null;
  }

  // ─── Evaluation Queries ─────────────────────────────────────────────

  /**
   * Returns a single aggregated evaluation row for a specific user + physician:
   *   - OVERALL_SCORE / dimension scores  → MEDIAN of most recent 3 sessions
   *   - FIELD_READINESS                   → MODE  of most recent 3 sessions
   *   - Boolean indicators (CK_C*, COMP_K*, TR_T*, CL_L*) → majority (> 50 %) of most recent 3
   *   - Rationales, RECOMMENDATIONS, COACHING_PRIORITY, OH_OBJECTION_DETAILS → from latest session
   */
  async queryAggregatedEvaluationByPhysician(
    appUserId: string,
    physicianId: string
  ): Promise<any> {
    const sql = `
      WITH last3 AS (
        SELECT *,
          ROW_NUMBER() OVER (ORDER BY EVALUATED_AT DESC) AS rn
        FROM CORTEX_TESTING.ML.REPEVAL_RESULTS
        WHERE APP_USER_ID = ?
          AND PHYSICIAN_ID = ?
      ),
      latest AS (
        SELECT * FROM last3 WHERE rn = 1
      ),
      top3 AS (
        SELECT * FROM last3 WHERE rn <= 3
      ),
      n AS (
        SELECT COUNT(*) AS cnt FROM top3
      ),
      median_scores AS (
        SELECT
          MEDIAN(OVERALL_SCORE)              AS OVERALL_SCORE,
          MEDIAN(CLINICAL_KNOWLEDGE_SCORE)   AS CLINICAL_KNOWLEDGE_SCORE,
          MEDIAN(OBJECTION_HANDLING_SCORE)   AS OBJECTION_HANDLING_SCORE,
          MEDIAN(COMPLIANCE_SCORE)           AS COMPLIANCE_SCORE,
          MEDIAN(TONE_RAPPORT_SCORE)         AS TONE_RAPPORT_SCORE,
          MEDIAN(CLOSING_SCORE)              AS CLOSING_SCORE
        FROM top3
      ),
      readiness_mode AS (
        SELECT FIELD_READINESS
        FROM (
          SELECT FIELD_READINESS,
            ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC, FIELD_READINESS) AS mode_rn
          FROM top3
          WHERE FIELD_READINESS IS NOT NULL
          GROUP BY FIELD_READINESS
        )
        WHERE mode_rn = 1
      ),
      rec_agg AS (
        SELECT ARRAY_AGG(DISTINCT r.value::STRING) AS RECOMMENDATIONS
        FROM top3,
        LATERAL FLATTEN(input => RECOMMENDATIONS) r
        WHERE RECOMMENDATIONS IS NOT NULL
      ),
      coaching_mode AS (
        SELECT COACHING_PRIORITY
        FROM (
          SELECT COACHING_PRIORITY,
            ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC, COACHING_PRIORITY) AS mode_rn
          FROM top3
          WHERE COACHING_PRIORITY IS NOT NULL
          GROUP BY COACHING_PRIORITY
        )
        WHERE mode_rn = 1
      ),
      bool_agg AS (
        SELECT
          SUM(CASE WHEN CK_C1 THEN 1 ELSE 0 END)    AS CK_C1,
          SUM(CASE WHEN CK_C2 THEN 1 ELSE 0 END)    AS CK_C2,
          SUM(CASE WHEN CK_C3 THEN 1 ELSE 0 END)    AS CK_C3,
          SUM(CASE WHEN CK_C4 THEN 1 ELSE 0 END)    AS CK_C4,
          SUM(CASE WHEN CK_C5 THEN 1 ELSE 0 END)    AS CK_C5,
          SUM(CASE WHEN CK_C6 THEN 1 ELSE 0 END)    AS CK_C6,
          SUM(CASE WHEN CK_C7 THEN 1 ELSE 0 END)    AS CK_C7,
          SUM(CASE WHEN CK_C8 THEN 1 ELSE 0 END)    AS CK_C8,
          SUM(CASE WHEN COMP_K1 THEN 1 ELSE 0 END)  AS COMP_K1,
          SUM(CASE WHEN COMP_K2 THEN 1 ELSE 0 END)  AS COMP_K2,
          SUM(CASE WHEN COMP_K3 THEN 1 ELSE 0 END)  AS COMP_K3,
          SUM(CASE WHEN COMP_K4 THEN 1 ELSE 0 END)  AS COMP_K4,
          SUM(CASE WHEN COMP_K5 THEN 1 ELSE 0 END)  AS COMP_K5,
          SUM(CASE WHEN COMP_K6 THEN 1 ELSE 0 END)  AS COMP_K6,
          SUM(CASE WHEN TR_T1 THEN 1 ELSE 0 END)    AS TR_T1,
          SUM(CASE WHEN TR_T2 THEN 1 ELSE 0 END)    AS TR_T2,
          SUM(CASE WHEN TR_T3 THEN 1 ELSE 0 END)    AS TR_T3,
          SUM(CASE WHEN TR_T4 THEN 1 ELSE 0 END)    AS TR_T4,
          SUM(CASE WHEN TR_T5 THEN 1 ELSE 0 END)    AS TR_T5,
          SUM(CASE WHEN TR_T6 THEN 1 ELSE 0 END)    AS TR_T6,
          SUM(CASE WHEN TR_T7 THEN 1 ELSE 0 END)    AS TR_T7,
          SUM(CASE WHEN CL_L1 THEN 1 ELSE 0 END)    AS CL_L1,
          SUM(CASE WHEN CL_L2 THEN 1 ELSE 0 END)    AS CL_L2,
          SUM(CASE WHEN CL_L3 THEN 1 ELSE 0 END)    AS CL_L3,
          SUM(CASE WHEN CL_L4 THEN 1 ELSE 0 END)    AS CL_L4,
          SUM(CASE WHEN CL_L5 THEN 1 ELSE 0 END)    AS CL_L5,
          SUM(CASE WHEN CL_L6 THEN 1 ELSE 0 END)    AS CL_L6
        FROM top3
      )
      SELECT
        l.PHYSICIAN_ID,
        l.PHYSICIAN_FIRST_NAME,
        l.PHYSICIAN_LAST_NAME,
        l.PHYSICIAN_SPECIALTY,
        l.SEGMENT_NAME,
        l.CLINICAL_KNOWLEDGE_RATIONALE,
        l.OBJECTION_HANDLING_RATIONALE,
        l.COMPLIANCE_RATIONALE,
        l.TONE_RAPPORT_RATIONALE,
        l.CLOSING_RATIONALE,
        l.OH_OBJECTION_DETAILS,
        ra.RECOMMENDATIONS,
        cm.COACHING_PRIORITY,
        l.EVALUATED_AT,
        rm.FIELD_READINESS,
        ms.OVERALL_SCORE,
        ms.CLINICAL_KNOWLEDGE_SCORE,
        ms.OBJECTION_HANDLING_SCORE,
        ms.COMPLIANCE_SCORE,
        ms.TONE_RAPPORT_SCORE,
        ms.CLOSING_SCORE,
        (ba.CK_C1   > n.cnt / 2) AS CK_C1,
        (ba.CK_C2   > n.cnt / 2) AS CK_C2,
        (ba.CK_C3   > n.cnt / 2) AS CK_C3,
        (ba.CK_C4   > n.cnt / 2) AS CK_C4,
        (ba.CK_C5   > n.cnt / 2) AS CK_C5,
        (ba.CK_C6   > n.cnt / 2) AS CK_C6,
        (ba.CK_C7   > n.cnt / 2) AS CK_C7,
        (ba.CK_C8   > n.cnt / 2) AS CK_C8,
        (ba.COMP_K1 > n.cnt / 2) AS COMP_K1,
        (ba.COMP_K2 > n.cnt / 2) AS COMP_K2,
        (ba.COMP_K3 > n.cnt / 2) AS COMP_K3,
        (ba.COMP_K4 > n.cnt / 2) AS COMP_K4,
        (ba.COMP_K5 > n.cnt / 2) AS COMP_K5,
        (ba.COMP_K6 > n.cnt / 2) AS COMP_K6,
        (ba.TR_T1   > n.cnt / 2) AS TR_T1,
        (ba.TR_T2   > n.cnt / 2) AS TR_T2,
        (ba.TR_T3   > n.cnt / 2) AS TR_T3,
        (ba.TR_T4   > n.cnt / 2) AS TR_T4,
        (ba.TR_T5   > n.cnt / 2) AS TR_T5,
        (ba.TR_T6   > n.cnt / 2) AS TR_T6,
        (ba.TR_T7   > n.cnt / 2) AS TR_T7,
        (ba.CL_L1   > n.cnt / 2) AS CL_L1,
        (ba.CL_L2   > n.cnt / 2) AS CL_L2,
        (ba.CL_L3   > n.cnt / 2) AS CL_L3,
        (ba.CL_L4   > n.cnt / 2) AS CL_L4,
        (ba.CL_L5   > n.cnt / 2) AS CL_L5,
        (ba.CL_L6   > n.cnt / 2) AS CL_L6,
        n.cnt                      AS SESSION_COUNT
      FROM latest l
      CROSS JOIN median_scores ms
      CROSS JOIN bool_agg ba
      CROSS JOIN n
      LEFT JOIN readiness_mode rm ON 1 = 1
      LEFT JOIN rec_agg ra ON 1 = 1
      LEFT JOIN coaching_mode cm ON 1 = 1
    `;
    const results = await this.executeQuery(sql, {
      '1': { type: 'TEXT', value: appUserId },
      '2': { type: 'TEXT', value: physicianId },
    });
    return results?.[0] ?? null;
  }

  async queryEvaluationHistory(
    appUserId: string,
    physicianId: string
  ): Promise<any[]> {
    const sql = `
      SELECT
        CONVERT_TIMEZONE('UTC', 'America/New_York', EVALUATED_AT) AS EVALUATED_AT,
        OVERALL_SCORE,
        CLINICAL_KNOWLEDGE_SCORE,
        OBJECTION_HANDLING_SCORE,
        COMPLIANCE_SCORE,
        TONE_RAPPORT_SCORE,
        CLOSING_SCORE
      FROM CORTEX_TESTING.ML.REPEVAL_RESULTS
      WHERE APP_USER_ID = ?
        AND PHYSICIAN_ID = ?
      ORDER BY EVALUATED_AT ASC
    `;
    return await this.executeQuery(sql, {
      '1': { type: 'TEXT', value: appUserId },
      '2': { type: 'TEXT', value: physicianId },
    });
  }

  async queryEvaluationHistoryAllPhysicians(
    appUserId: string
  ): Promise<any[]> {
    const sql = `
      SELECT
        EVALUATED_AT::DATE AS EVALUATED_AT,
        MEDIAN(OVERALL_SCORE) AS OVERALL_SCORE,
        MEDIAN(CLINICAL_KNOWLEDGE_SCORE) AS CLINICAL_KNOWLEDGE_SCORE,
        MEDIAN(OBJECTION_HANDLING_SCORE) AS OBJECTION_HANDLING_SCORE,
        MEDIAN(COMPLIANCE_SCORE) AS COMPLIANCE_SCORE,
        MEDIAN(TONE_RAPPORT_SCORE) AS TONE_RAPPORT_SCORE,
        MEDIAN(CLOSING_SCORE) AS CLOSING_SCORE
      FROM CORTEX_TESTING.ML.REPEVAL_RESULTS
      WHERE APP_USER_ID = ?
      GROUP BY EVALUATED_AT::DATE
      ORDER BY EVALUATED_AT::DATE ASC
    `;
    return await this.executeQuery(sql, {
      '1': { type: 'TEXT', value: appUserId },
    });
  }

  // ✅ Segment median for THIS USER across physicians in same segment
  async querySegmentMedianScoresForUser(
    appUserId: string,
    segmentName: string
  ): Promise<any[]> {
    const sql = `
      SELECT
        EVALUATED_AT::DATE AS EVALUATED_AT,
        MEDIAN(OVERALL_SCORE) AS OVERALL_SCORE,
        MEDIAN(CLINICAL_KNOWLEDGE_SCORE) AS CLINICAL_KNOWLEDGE_SCORE,
        MEDIAN(OBJECTION_HANDLING_SCORE) AS OBJECTION_HANDLING_SCORE,
        MEDIAN(COMPLIANCE_SCORE) AS COMPLIANCE_SCORE,
        MEDIAN(TONE_RAPPORT_SCORE) AS TONE_RAPPORT_SCORE,
        MEDIAN(CLOSING_SCORE) AS CLOSING_SCORE
      FROM CORTEX_TESTING.ML.REPEVAL_RESULTS
      WHERE APP_USER_ID = ?
        AND SEGMENT_NAME = ?
      GROUP BY EVALUATED_AT::DATE
      ORDER BY EVALUATED_AT::DATE ASC
    `;
    return await this.executeQuery(sql, {
      '1': { type: 'TEXT', value: appUserId },
      '2': { type: 'TEXT', value: segmentName },
    });
  }

  /**
   * Overall performance summary across ALL physicians for a user.
   * N = 3 × (number of distinct segments the user has encountered).
   * Scores: MEDIAN of most recent N sessions.
   * FIELD_READINESS: derived from median overall score (≥8 Field Ready, ≥6 Coaching Needed).
   * COACHING_PRIORITY: MODE of most recent N sessions.
   */
  async queryOverallPerformance(appUserId: string): Promise<any> {
    const sql = `
      WITH all_sessions AS (
        SELECT *,
          ROW_NUMBER() OVER (ORDER BY EVALUATED_AT DESC) AS rn
        FROM CORTEX_TESTING.ML.REPEVAL_RESULTS
        WHERE APP_USER_ID = ?
      ),
      seg_count AS (
        SELECT COUNT(DISTINCT SEGMENT_NAME) AS cnt
        FROM CORTEX_TESTING.ML.REPEVAL_RESULTS
        WHERE APP_USER_ID = ?
          AND SEGMENT_NAME IS NOT NULL
      ),
      top_n AS (
        SELECT s.*
        FROM all_sessions s, seg_count sc
        WHERE s.rn <= GREATEST(sc.cnt * 3, 3)
      ),
      n AS (
        SELECT COUNT(*) AS cnt FROM top_n
      ),
      median_scores AS (
        SELECT
          MEDIAN(OVERALL_SCORE)              AS OVERALL_SCORE,
          MEDIAN(CLINICAL_KNOWLEDGE_SCORE)   AS CLINICAL_KNOWLEDGE_SCORE,
          MEDIAN(OBJECTION_HANDLING_SCORE)   AS OBJECTION_HANDLING_SCORE,
          MEDIAN(COMPLIANCE_SCORE)           AS COMPLIANCE_SCORE,
          MEDIAN(TONE_RAPPORT_SCORE)         AS TONE_RAPPORT_SCORE,
          MEDIAN(CLOSING_SCORE)              AS CLOSING_SCORE
        FROM top_n
      ),
      coaching_mode AS (
        SELECT COACHING_PRIORITY
        FROM (
          SELECT COACHING_PRIORITY,
            ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC, COACHING_PRIORITY) AS mode_rn
          FROM top_n
          WHERE COACHING_PRIORITY IS NOT NULL
          GROUP BY COACHING_PRIORITY
        )
        WHERE mode_rn = 1
      )
      SELECT
        ms.OVERALL_SCORE,
        ms.CLINICAL_KNOWLEDGE_SCORE,
        ms.OBJECTION_HANDLING_SCORE,
        ms.COMPLIANCE_SCORE,
        ms.TONE_RAPPORT_SCORE,
        ms.CLOSING_SCORE,
        cm.COACHING_PRIORITY,
        n.cnt                                              AS SESSION_COUNT,
        sc.cnt                                             AS SEGMENT_COUNT,
        CASE
          WHEN ms.OVERALL_SCORE >= 8 THEN 'Field Ready'
          WHEN ms.OVERALL_SCORE >= 6 THEN 'Coaching Needed'
          ELSE 'Not Field Ready'
        END                                                AS FIELD_READINESS
      FROM median_scores ms
      CROSS JOIN coaching_mode cm
      CROSS JOIN n
      CROSS JOIN seg_count sc
    `;
    const results = await this.executeQuery(sql, {
      '1': { type: 'TEXT', value: appUserId },
      '2': { type: 'TEXT', value: appUserId },
    });
    return results?.[0] ?? null;
  }

  /**
   * Per-segment performance summary — most recent 3 sessions per segment.
   * Returns one row per segment with median scores, mode coaching priority,
   * and derived FIELD_READINESS.
   */
  async queryPerformanceBySegment(appUserId: string): Promise<any[]> {
    const sql = `
      WITH ranked AS (
        SELECT *,
          ROW_NUMBER() OVER (PARTITION BY SEGMENT_NAME ORDER BY EVALUATED_AT DESC) AS rn
        FROM CORTEX_TESTING.ML.REPEVAL_RESULTS
        WHERE APP_USER_ID = ?
          AND SEGMENT_NAME IS NOT NULL
      ),
      top3 AS (
        SELECT * FROM ranked WHERE rn <= 3
      ),
      n_per_seg AS (
        SELECT SEGMENT_NAME, COUNT(*) AS cnt FROM top3 GROUP BY SEGMENT_NAME
      ),
      median_scores AS (
        SELECT
          SEGMENT_NAME,
          MEDIAN(OVERALL_SCORE)              AS OVERALL_SCORE,
          MEDIAN(CLINICAL_KNOWLEDGE_SCORE)   AS CLINICAL_KNOWLEDGE_SCORE,
          MEDIAN(OBJECTION_HANDLING_SCORE)   AS OBJECTION_HANDLING_SCORE,
          MEDIAN(COMPLIANCE_SCORE)           AS COMPLIANCE_SCORE,
          MEDIAN(TONE_RAPPORT_SCORE)         AS TONE_RAPPORT_SCORE,
          MEDIAN(CLOSING_SCORE)              AS CLOSING_SCORE
        FROM top3
        GROUP BY SEGMENT_NAME
      ),
      coaching_mode AS (
        SELECT SEGMENT_NAME, COACHING_PRIORITY
        FROM (
          SELECT SEGMENT_NAME, COACHING_PRIORITY,
            ROW_NUMBER() OVER (
              PARTITION BY SEGMENT_NAME
              ORDER BY COUNT(*) DESC, COACHING_PRIORITY
            ) AS mode_rn
          FROM top3
          WHERE COACHING_PRIORITY IS NOT NULL
          GROUP BY SEGMENT_NAME, COACHING_PRIORITY
        )
        WHERE mode_rn = 1
      )
      SELECT
        ms.SEGMENT_NAME,
        ms.OVERALL_SCORE,
        ms.CLINICAL_KNOWLEDGE_SCORE,
        ms.OBJECTION_HANDLING_SCORE,
        ms.COMPLIANCE_SCORE,
        ms.TONE_RAPPORT_SCORE,
        ms.CLOSING_SCORE,
        n.cnt                                              AS SESSION_COUNT,
        cm.COACHING_PRIORITY,
        CASE
          WHEN ms.OVERALL_SCORE >= 8 THEN 'Field Ready'
          WHEN ms.OVERALL_SCORE >= 6 THEN 'Coaching Needed'
          ELSE 'Not Field Ready'
        END                                                AS FIELD_READINESS
      FROM median_scores ms
      LEFT JOIN n_per_seg n     ON ms.SEGMENT_NAME = n.SEGMENT_NAME
      LEFT JOIN coaching_mode cm ON ms.SEGMENT_NAME = cm.SEGMENT_NAME
      ORDER BY ms.SEGMENT_NAME
    `;
    return await this.executeQuery(sql, {
      '1': { type: 'TEXT', value: appUserId },
    });
  }

  /**
   * Daily median scores per segment over the past 12 months.
   * Returns rows with SEGMENT_NAME — client groups by segment for per-segment charts.
   */
  async queryPerformanceTrendBySegment(appUserId: string): Promise<any[]> {
    const sql = `
      SELECT
        SEGMENT_NAME,
        EVALUATED_AT::DATE                             AS EVALUATED_AT,
        MEDIAN(OVERALL_SCORE)                          AS OVERALL_SCORE,
        MEDIAN(CLINICAL_KNOWLEDGE_SCORE)               AS CLINICAL_KNOWLEDGE_SCORE,
        MEDIAN(OBJECTION_HANDLING_SCORE)               AS OBJECTION_HANDLING_SCORE,
        MEDIAN(COMPLIANCE_SCORE)                       AS COMPLIANCE_SCORE,
        MEDIAN(TONE_RAPPORT_SCORE)                     AS TONE_RAPPORT_SCORE,
        MEDIAN(CLOSING_SCORE)                          AS CLOSING_SCORE
      FROM CORTEX_TESTING.ML.REPEVAL_RESULTS
      WHERE APP_USER_ID = ?
        AND SEGMENT_NAME IS NOT NULL
        AND EVALUATED_AT >= DATEADD(year, -1, CURRENT_TIMESTAMP)
      GROUP BY SEGMENT_NAME, EVALUATED_AT::DATE
      ORDER BY SEGMENT_NAME, EVALUATED_AT::DATE ASC
    `;
    return await this.executeQuery(sql, {
      '1': { type: 'TEXT', value: appUserId },
    });
  }

  /**
   * Daily median scores over the past 12 months for a user (all physicians).
   * Used for the trend line chart on the Performance panel.
   */
  async queryPerformanceTrend(appUserId: string): Promise<any[]> {
    const sql = `
      SELECT
        EVALUATED_AT::DATE                             AS EVALUATED_AT,
        MEDIAN(OVERALL_SCORE)                          AS OVERALL_SCORE,
        MEDIAN(CLINICAL_KNOWLEDGE_SCORE)               AS CLINICAL_KNOWLEDGE_SCORE,
        MEDIAN(OBJECTION_HANDLING_SCORE)               AS OBJECTION_HANDLING_SCORE,
        MEDIAN(COMPLIANCE_SCORE)                       AS COMPLIANCE_SCORE,
        MEDIAN(TONE_RAPPORT_SCORE)                     AS TONE_RAPPORT_SCORE,
        MEDIAN(CLOSING_SCORE)                          AS CLOSING_SCORE
      FROM CORTEX_TESTING.ML.REPEVAL_RESULTS
      WHERE APP_USER_ID = ?
        AND EVALUATED_AT >= DATEADD(year, -1, CURRENT_TIMESTAMP)
      GROUP BY EVALUATED_AT::DATE
      ORDER BY EVALUATED_AT::DATE ASC
    `;
    return await this.executeQuery(sql, {
      '1': { type: 'TEXT', value: appUserId },
    });
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────

let clientInstance: SnowflakeClient | null = null;

export function getSnowflakeClient(): SnowflakeClient {
  if (!clientInstance) {
    clientInstance = new SnowflakeClient();
  }
  return clientInstance;
}