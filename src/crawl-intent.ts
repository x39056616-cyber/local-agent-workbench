export function requestsCrawl(prompt:string){
 const text=prompt.replace(/```[\s\S]*?```/g,'').replace(/(?:不要|不用|无需|禁止|不得)(?:再)?(?:爬取|抓取|采集|crawl|scrape)[^。！？；;，,\n但]*/gi,'');
 const explain=/^(?:请问[，,\s]*)?(?:请|帮我)?(?:解释|讲解|介绍|什么是|为什么|如何|怎么|explain\b|what\b|why\b|how\b)/i.test(text);
 if(explain&&!/(?:帮我|替我|实际|直接|现在|然后|并且?)(?:去)?(?:爬取|抓取|采集|crawl|scrape)/i.test(text))return false;
 return /爬取|抓取|采集|\bcrawl(?:ing)?\b|\bscrap(?:e|ing)\b/i.test(text);
}
