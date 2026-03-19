// Upload batch render images to Google Drive
// POST { projectName, images: [{ base64, mimeType, filename }] }
// Returns { folderUrl, files: [{ filename, fileUrl }] }

import { NextRequest, NextResponse } from "next/server";
import { createDriveFolder, uploadImageToDrive } from "@/lib/drive";

export const maxDuration = 120; // uploading multiple images can take a while

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      projectName: string;
      images: Array<{ base64: string; mimeType: string; filename: string }>;
    };

    const { projectName, images } = body;

    if (!images || images.length === 0) {
      return NextResponse.json(
        { error: "No images provided." },
        { status: 400 }
      );
    }

    // Create a project subfolder with date
    const date = new Date().toISOString().slice(0, 10);
    const folderName = `${projectName} — ${date}`;
    const { folderId, folderUrl } = await createDriveFolder(folderName);

    // Upload all images in parallel (within the folder)
    const results = await Promise.allSettled(
      images.map((img) =>
        uploadImageToDrive(img.base64, img.mimeType, img.filename, folderId)
      )
    );

    const files = results.map((r, i) => ({
      filename: images[i].filename,
      fileUrl: r.status === "fulfilled" ? r.value.fileUrl : null,
      error: r.status === "rejected" ? String(r.reason) : null,
    }));

    return NextResponse.json({ folderUrl, files });
  } catch (err) {
    console.error("[Drive Upload]", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Something went wrong uploading to Google Drive.",
      },
      { status: 500 }
    );
  }
}
