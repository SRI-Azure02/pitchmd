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

  async queryLatestEvaluationByAppUser(
    appUserId: string,
    physicianId?: string
  ): Promise<any> {
    if (physicianId) {
      const sql = `
        SELECT *
        FROM CORTEX_TESTING.ML.REPEVAL_RESULTS
        WHERE APP_USER_ID = ?
          AND PHYSICIAN_ID = ?
        ORDER BY EVALUATED_AT DESC
        LIMIT 1
      `;
      const results = await this.executeQuery(sql, {
        '1': { type: 'TEXT', value: appUserId },
        '2': { type: 'TEXT', value: physicianId },
      });
      return results?.[0] ?? null;
    }

    const sql = `
      SELECT *
      FROM CORTEX_TESTING.ML.REPEVAL_RESULTS
      WHERE APP_USER_ID = ?
      ORDER BY EVALUATED_AT DESC
      LIMIT 1
    `;
    const results = await this.executeQuery(sql, {
      '1': { type: 'TEXT', value: appUserId },
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
}

// ─── Singleton ─────────────────────────────────────────────────────────

let clientInstance: SnowflakeClient | null = null;

export function getSnowflakeClient(): SnowflakeClient {
  if (!clientInstance) {
    clientInstance = new SnowflakeClient();
  }
  return clientInstance;
}