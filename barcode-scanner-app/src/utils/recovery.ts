import { Filesystem, Directory } from '@capacitor/filesystem';


export const processRestoredImage = async (result: any): Promise<boolean> => {
  if (result.pluginId !== 'Camera' || result.methodName !== 'getPhoto' || !result.success) {
    return false;
  }

  const contextStr = localStorage.getItem('camera_context');
  if (!contextStr) return false;

  try {
    JSON.parse(contextStr);
    const photo = result.data;
    
    if (!photo?.path) return false;

    // 1. Save to Filesystem
    const fileName = `restored_${Date.now()}.jpg`;
    await Filesystem.copy({
      from: photo.path,
      to: fileName,
      toDirectory: Directory.Data
    });

/* 
    Legacy image recovery is disabled. We are now a text-only workflow.
    Images should only be processed through the cropping and OCR flow.
    */
    localStorage.removeItem('camera_context');
    return false;
  } catch (e) {
    console.error("Recovery Error:", e);
  }

  return false;
};
