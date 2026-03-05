require('dotenv').config()
const TelegramBot = require('node-telegram-bot-api')
const axios = require('axios')
const fs = require('fs')
const cron = require('node-cron')

const bot = new TelegramBot(process.env.BOT_TOKEN,{polling:true})

let leaderboard={}
let pollAnswers={}
let quizSessions={}

const subjects=[
"reasoning",
"history",
"physics",
"chemistry",
"biology",
"geography",
"civics",
"statics"
]

if(fs.existsSync("leaderboard.json")){
leaderboard=JSON.parse(fs.readFileSync("leaderboard.json"))
}

function saveLeaderboard(){
fs.writeFileSync("leaderboard.json",JSON.stringify(leaderboard,null,2))
}

async function isAdmin(chatId,userId){
try{
const member=await bot.getChatMember(chatId,userId)
return member.status==="creator"||member.status==="administrator"
}catch{
return false
}
}

async function generateQuestion(subject){

try{

const response=await axios.post(
"https://openrouter.ai/api/v1/chat/completions",
{
model:"openai/gpt-3.5-turbo",
messages:[
{
role:"user",
content:`NMMS परीक्षा स्तर का एक बहुविकल्पीय प्रश्न बनाओ विषय: ${subject}

सब हिंदी में हो।

Format:

Question: प्रश्न

A) विकल्प
B) विकल्प
C) विकल्प
D) विकल्प

Correct: A/B/C/D`
}
]
},
{
headers:{
Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,
"Content-Type":"application/json",
"HTTP-Referer":"https://localhost",
"X-Title":"NMMS Quiz Bot"
}
}
)

return response.data.choices[0].message.content

}catch(err){

console.log("AI Error:",err.response?.data || err.message)

return null

}

}

async function sendQuestion(chatId){

const session=quizSessions[chatId]

if(!session) return

if(session.current>=session.total){

bot.sendMessage(chatId,"✅ क्विज समाप्त हो गया")

delete quizSessions[chatId]

return
}

let subject=session.subject

if(subject==="mix"){
subject=subjects[Math.floor(Math.random()*subjects.length)]
}

const data=await generateQuestion(subject)

if(!data){

bot.sendMessage(chatId,"⚠️ AI Error, अगला प्रश्न लाया जा रहा है...")

setTimeout(()=>sendQuestion(chatId),5000)

return
}

try{

const question=data.match(/Question:\s*(.*)/i)[1]

const options=[
data.match(/A\)\s*(.*)/i)[1],
data.match(/B\)\s*(.*)/i)[1],
data.match(/C\)\s*(.*)/i)[1],
data.match(/D\)\s*(.*)/i)[1]
]

const correctLetter=data.match(/Correct:\s*(.*)/i)[1].trim().toUpperCase()

const correctIndex=["A","B","C","D"].indexOf(correctLetter)

const poll=await bot.sendPoll(
chatId,
`(${session.current+1}/${session.total}) ${question}`,
options,
{
type:"quiz",
correct_option_id:correctIndex,
is_anonymous:false
}
)

pollAnswers[poll.poll.id]=correctIndex

session.current++

setTimeout(()=>{

sendQuestion(chatId)

},40000)

}catch{

bot.sendMessage(chatId,"⚠️ Parsing Error, अगला प्रश्न...")

setTimeout(()=>sendQuestion(chatId),5000)

}

}

bot.onText(/\/start/,msg=>{

bot.sendMessage(msg.chat.id,
`📚 NMMS Quiz Bot

Commands:

/quiz reasoning
/quiz history
/quiz physics
/quiz chemistry
/quiz biology
/quiz geography
/quiz civics
/quiz statics

/mixquiz

/leaderboard`
)

})

bot.onText(/\/quiz (.+)/,async(msg,match)=>{

const chatId=msg.chat.id
const userId=msg.from.id
const subject=match[1]

if(msg.chat.type!=="private"){
const admin=await isAdmin(chatId,userId)
if(!admin){
return bot.sendMessage(chatId,"❌ केवल एडमिन क्विज शुरू कर सकता है")
}
}

quizSessions[chatId]={subject:subject}

bot.sendMessage(chatId,"कितने प्रश्न चाहिए?")

})

bot.onText(/\/mixquiz/,async(msg)=>{

const chatId=msg.chat.id
const userId=msg.from.id

if(msg.chat.type!=="private"){
const admin=await isAdmin(chatId,userId)
if(!admin){
return bot.sendMessage(chatId,"❌ केवल एडमिन क्विज शुरू कर सकता है")
}
}

quizSessions[chatId]={subject:"mix"}

bot.sendMessage(chatId,"कितने प्रश्न चाहिए?")

})

bot.on("message",msg=>{

const chatId=msg.chat.id

if(!quizSessions[chatId]) return

if(quizSessions[chatId].total) return

const num=parseInt(msg.text)

if(isNaN(num)) return

quizSessions[chatId].total=num
quizSessions[chatId].current=0

bot.sendMessage(chatId,"🚀 क्विज शुरू हो रहा है")

sendQuestion(chatId)

})

bot.on("poll_answer",answer=>{

const user=answer.user
const pollId=answer.poll_id

if(!(pollId in pollAnswers)) return

const correctIndex=pollAnswers[pollId]

if(!leaderboard[user.id]){

leaderboard[user.id]={
name:user.first_name,
score:0
}

}

if(answer.option_ids[0]===correctIndex){

leaderboard[user.id].score++

}

saveLeaderboard()

})

bot.onText(/\/leaderboard/,msg=>{

let users=Object.values(leaderboard)

users.sort((a,b)=>b.score-a.score)

let text="🏆 Leaderboard\n\n"

users.slice(0,10).forEach((u,i)=>{

text+=`${i+1}. ${u.name} — ${u.score}\n`

})

bot.sendMessage(msg.chat.id,text)

})

cron.schedule("0 18 * * *",()=>{

const chatId=process.env.CHAT_ID

quizSessions[chatId]={subject:"mix",total:10,current:0}

bot.sendMessage(chatId,"📅 Daily Quiz Start!")

sendQuestion(chatId)

})
