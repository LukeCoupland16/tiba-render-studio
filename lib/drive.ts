// ─────────────────────────────────────────────────────────────────────────────
// Google Drive client — uses a service account for server-side uploads
// ─────────────────────────────────────────────────────────────────────────────
//
// Required env vars:
//   GOOGLE_SERVICE_ACCOUNT_JSON — the full JSON key (stringified)
//   GOOGLE_DRIVE_PARENT_FOLDER_ID — shared parent folder where project
//                                    subfolders are created
// ─────────────────────────────────────────────────────────────────────────────

import { google } from "googleapis";
import { Readable } from "stream";

function getDriveClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set in .env.local");

  const credentials = JSON.parse(raw);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });

  return google.drive({ version: "v3", auth });
}

/** Create a subfolder inside the parent folder. Returns { folderId, folderUrl }. */
export async function createDriveFolder(
  name: string,
  parentFolderId?: string
): Promise<{ folderId: string; folderUrl: string }> {
  const drive = getDriveClient();
  const parent =
    parentFolderId || process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID || undefined;

  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parent ? { parents: [parent] } : {}),
    },
    fields: "id, webViewLink",
  });

  return {
    folderId: res.data.id!,
    folderUrl: res.data.webViewLink!,
  };
}

/** Upload a base64 image to a Drive folder. Returns the file's web link. */
export async function uploadImageToDrive(
  base64: string,
  mimeType: string,
  filename: string,
  folderId: string
): Promise<{ fileId: string; fileUrl: string }> {
  const drive = getDriveClient();

  const buffer = Buffer.from(base64, "base64");
  const stream = Readable.from(buffer);

  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: stream,
    },
    fields: "id, webViewLink",
  });

  return {
    fileId: res.data.id!,
    fileUrl: res.data.webViewLink!,
  };
}
