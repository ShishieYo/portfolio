import { z } from "zod";
import { ROLES } from "../shared/permissions";

const text = (max = 200) => z.string().max(max);
const num = z.number().finite().nullable();
const serial = z.object({ qty: num, from: num, to: num });

/** Shape check only. Whether the values are *right* is the validation engine's job. */
export const reportSchema = z.object({
  header: z.object({
    entityName: text(),
    fundCluster: text(),
    period: text(20),
    certificationDate: text(20),
    preparedByName: text(), preparedByTitle: text(),
    checkedByName: text(), checkedByTitle: text(),
    attestedByName: text(), attestedByTitle: text(),
    notedByName: text(), notedByTitle: text(),
  }),
  totals: z.object({ lineCount: num, beginningQty: num, receiptQty: num, issueQty: num, endingQty: num }),
  lines: z
    .array(
      z.object({
        formName: text(),
        formNumber: text(50),
        faceValue: num,
        beginning: serial,
        receipt: serial,
        issue: serial,
        ending: serial,
        remarks: text(500),
      }),
    )
    .max(500),
});

export const createRecordSchema = z.object({
  idempotencyKey: z.string().min(8).max(100),
  report: reportSchema,
});

export const updateRecordSchema = z.object({
  expectedVersion: z.number().int().positive(),
  report: reportSchema,
});

export const noteSchema = z.object({ note: z.string().max(1000).default("") });

export const ruleUpdateSchema = z.object({
  severity: z.enum(["ERROR", "WARNING"]),
  enabled: z.boolean(),
  message: z.string().min(1).max(500),
  resolution: z.string().min(1).max(500),
  condition: z.record(z.string(), z.unknown()),
});

export const loginSchema = z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(200) });

export const userCreateSchema = z.object({
  username: z.string().regex(/^[a-zA-Z0-9._-]{3,40}$/, "3-40 letters, digits, . _ -"),
  displayName: z.string().min(1).max(100),
  password: z.string().min(10).max(200),
  role: z.enum(ROLES as [string, ...string[]]),
});

export const userUpdateSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  role: z.enum(ROLES as [string, ...string[]]).optional(),
  active: z.boolean().optional(),
  password: z.string().min(10).max(200).optional(),
});

export const SETTING_KEYS = ["defaultEntityName", "defaultFundCluster", "defaultPreparedByName", "defaultPreparedByTitle", "defaultCheckedByName", "defaultCheckedByTitle", "defaultAttestedByName", "defaultAttestedByTitle", "defaultNotedByName", "defaultNotedByTitle"] as const;
export const settingsSchema = z.object(Object.fromEntries(SETTING_KEYS.map((k) => [k, z.string().max(200)])) as Record<(typeof SETTING_KEYS)[number], z.ZodString>);
