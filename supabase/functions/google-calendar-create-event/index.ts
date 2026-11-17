import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
function fromB64(s:string){return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
async function decrypt(cipher:string,iv:string,secret:string){
 const raw=fromB64(secret);if(raw.length!==32)throw new Error("Invalid encryption key");
 const key=await crypto.subtle.importKey("raw",raw,"AES-GCM",false,["decrypt"]);
 const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:fromB64(iv)},key,fromB64(cipher));
 return JSON.parse(new TextDecoder().decode(plain));
}
async function encrypt(value:string,secret:string){
 const raw=fromB64(secret);const key=await crypto.subtle.importKey("raw",raw,"AES-GCM",false,["encrypt"]);
 const iv=crypto.getRandomValues(new Uint8Array(12));const cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(value));
 const b64=(v:Uint8Array)=>btoa(String.fromCharCode(...v));
 return {encrypted_tokens:b64(new Uint8Array(cipher)),encryption_iv:b64(iv)};
}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 try{
  const bearer=(req.headers.get("Authorization")||"").replace(/^Bearer\\s+/i,"");if(!bearer)return json({error:"Sessão não informada."},401);
  const url=Deno.env.get("SUPABASE_URL")!,admin=createClient(url,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const userClient=createClient(url,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:`Bearer ${bearer}`}}});
  const {data:{user}}=await userClient.auth.getUser();if(!user)return json({error:"Sessão inválida."},401);
  const body=await req.json();
  const start=new Date(body.start_at),end=new Date(body.end_at);
  if(!body.summary||!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start)return json({error:"Informe título e intervalo válido."},400);
  const {data:row,error}=await admin.from("google_calendar_connections").select("encrypted_tokens,encryption_iv").eq("professional_id",user.id).maybeSingle();
  if(error||!row)return json({error:"Conecte sua conta Google antes de criar reuniões."},409);
  const secret=Deno.env.get("GOOGLE_TOKEN_ENCRYPTION_KEY")!;
  const tokens=await decrypt(row.encrypted_tokens,row.encryption_iv,secret);
  let accessToken=tokens.access_token;
  if(!accessToken||Number(tokens.expires_in||0)===0||Date.now()>(Number(tokens.created_at||0)+Number(tokens.expires_in||0)-60)*1000){
    if(!tokens.refresh_token)return json({error:"A autorização expirou. Reconecte sua conta Google."},401);
    const refreshed=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:Deno.env.get("GOOGLE_CLIENT_ID")!,client_secret:Deno.env.get("GOOGLE_CLIENT_SECRET")!,refresh_token:tokens.refresh_token,grant_type:"refresh_token"})});
    const next=await refreshed.json();if(!refreshed.ok)throw new Error("Google token refresh failed");
    Object.assign(tokens,next,{created_at:Math.floor(Date.now()/1000),refresh_token:tokens.refresh_token});
    const encrypted=await encrypt(JSON.stringify(tokens),secret);
    await admin.from("google_calendar_connections").update({...encrypted,updated_at:new Date().toISOString()}).eq("professional_id",user.id);
    accessToken=tokens.access_token;
  }
  const eventBody={summary:String(body.summary).slice(0,250),description:body.description?String(body.description).slice(0,8000):"Consulta agendada pelo OrientaDor.",start:{dateTime:start.toISOString()},end:{dateTime:end.toISOString()},conferenceData:{createRequest:{requestId:crypto.randomUUID(),conferenceSolutionKey:{type:"hangoutsMeet"}}}};
  const response=await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all",{method:"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json"},body:JSON.stringify(eventBody)});
  const result=await response.json();if(!response.ok){console.error("Google Calendar event error",result.error?.status);return json({error:"O Google não conseguiu criar o evento. Verifique a conexão e tente novamente."},502)}
  const meetUrl=result.hangoutLink||result.conferenceData?.entryPoints?.find((p:any)=>p.entryPointType==="video")?.uri||null;
  return json({event_id:result.id||null,event_url:result.htmlLink||null,meet_url:meetUrl});
 }catch(error){console.error("google-calendar-create-event",error);return json({error:"Não foi possível criar o evento no Google Agenda."},500)}
});