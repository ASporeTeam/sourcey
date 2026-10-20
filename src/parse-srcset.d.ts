declare module "parse-srcset" {
  interface Candidate { url: string; w?: number; h?: number; d?: number }
  export default function parseSrcset(input: string): Candidate[];
}
