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

  constructor() {
    this.account = process.env.SNOWFLAKE_ACCOUNT || '';
    this.warehouse = process.env.SNOWFLAKE_WAREHOUSE || '';
    this.pat =
      process.env.SNOWFLAKE_PAT ||
      process.env.SNOWFLAKE_PASSWORD ||
      '';

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
    options: SnowflakeQueryOptions = {}
  ): Promise<any[]> {
    const response = await axios.post(
      `${this.baseURL}/statements`,
      {
        statement: sql,
        database: options.database || 'CORTEX_TESTING',
        schema: options.schema || 'PUBLIC',
        warehouse: options.warehouse || this.warehouse,
      },
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

  // ─── Evaluation Queries ─────────────────────────────────────────────

  async queryLatestEvaluationByAppUser(
    appUserId: string
  ): Promise<any> {
    const sql = `
      SELECT *
      FROM CORTEX_TESTING.ML.REPEVAL_RESULTS
      WHERE APP_USER_ID = '${appUserId}'
      ORDER BY EVALUATED_AT DESC
      LIMIT 1
    `;
    const results = await this.executeQuery(sql);
    return results?.[0] ?? null;
  }

  async queryEvaluationHistory(
    appUserId: string,
    physicianId: string
  ): Promise<any[]> {
    const sql = `
      SELECT
        TO_DATE(CONVERT_TIMEZONE('UTC', 'America/New_York', EVALUATED_AT)) AS EVALUATED_AT,
        OVERALL_SCORE,
        CLINICAL_KNOWLEDGE_SCORE,
        OBJECTION_HANDLING_SCORE,
        COMPLIANCE_SCORE,
        TONE_RAPPORT_SCORE,
        CLOSING_SCORE
      FROM CORTEX_TESTING.ML.REPEVAL_RESULTS
      WHERE APP_USER_ID = '${appUserId}'
        AND PHYSICIAN_ID = '${physicianId}'
      ORDER BY EVALUATED_AT ASC
    `;
    return await this.executeQuery(sql);
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
      WHERE APP_USER_ID = '${appUserId}'
      GROUP BY EVALUATED_AT::DATE
      ORDER BY EVALUATED_AT::DATE ASC
    `;
    return await this.executeQuery(sql);
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
      WHERE APP_USER_ID = '${appUserId}'
        AND SEGMENT_NAME = '${segmentName}'
      GROUP BY EVALUATED_AT::DATE
      ORDER BY EVALUATED_AT::DATE ASC
    `;
    return await this.executeQuery(sql);
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