declare module "@mediapipe/tasks-vision" {
  export class FilesetResolver {
    static forVisionTasks(wasmRoot: string): Promise<any>;
  }
  export class HandLandmarker {
    static createFromOptions(fileset: any, options: any): Promise<any>;
    detectForVideo(
      video: HTMLVideoElement,
      timestamp: number
    ): {
      landmarks?: { x: number; y: number; z?: number }[][];
      handednesses?: {
        categories: { categoryName: string; score: number }[];
      }[];
    };
    close(): void;
  }
}
