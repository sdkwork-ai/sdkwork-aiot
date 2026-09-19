/**
 * Application upload declaration constants.
 *
 * Authority: `DRIVE_SPEC.md` section 18 (Application Upload Declaration Contract).
 * Declared values live in `apps/sdkwork-aiot-pc/specs/upload.declaration.json`; this module
 * carries them into code so upload call sites reference a constant instead of repeating
 * literals. Call sites MUST NOT inline these values, and the declaration MUST NOT be
 * duplicated as a second local authority.
 *
 * The previous local values (`aiot-firmware-artifact`, `aiot_firmware_upload`,
 * `aiot_pc_admin`) were not rule-conforming: `appResourceType` must be a dotted
 * `<domain>.<resource>` business type, `scene` and `source` must be lowercase kebab-case.
 * They are converged here to the declared values.
 */

export interface AiotPcUploadDeclarationEntry {
  readonly appResourceIdKind: "application" | "entity" | "draft";
  readonly appResourceType: string;
  readonly purpose: string;
  readonly retention: "long_term" | "temporary";
  readonly scene: string;
  readonly source: string;
  readonly uploadProfileCode: string;
}

/** The single call-origin label for every upload from this application. */
export const AIOT_PC_UPLOAD_SOURCE = "sdkwork-aiot-pc" as const;

const AIOT_PC_APP_RESOURCE_ID_KIND = "entity" as const;
const AIOT_PC_RETENTION = "long_term" as const;

/**
 * IoT device firmware artifact uploaded from the admin console so a device model can
 * reference a flashable image.
 */
export const AIOT_PC_FIRMWARE_ARTIFACT_UPLOAD = {
  appResourceIdKind: AIOT_PC_APP_RESOURCE_ID_KIND,
  appResourceType: "aiot.firmware_artifact",
  purpose:
    "IoT device firmware artifact uploaded from the admin console so a device model can reference a flashable image.",
  retention: AIOT_PC_RETENTION,
  scene: "firmware-upload",
  source: AIOT_PC_UPLOAD_SOURCE,
  uploadProfileCode: "archive",
} as const satisfies AiotPcUploadDeclarationEntry;

/** Every declared upload purpose for this application. */
export const AIOT_PC_UPLOAD_DECLARATIONS: readonly AiotPcUploadDeclarationEntry[] = [
  AIOT_PC_FIRMWARE_ARTIFACT_UPLOAD,
];
