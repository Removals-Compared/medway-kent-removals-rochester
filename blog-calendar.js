// ══════════════════════════════════════════════════════
//  MKR 30-Day Blog Calendar
//  All post data pre-loaded — title, slug, category,
//  keywords and Facebook/Instagram caption for each day
// ══════════════════════════════════════════════════════

const CALENDAR = [
  {
    day: 1,
    title: "How to choose the right removal company in Rochester and Medway",
    slug: "how-to-choose-removal-company-rochester",
    category: "Moving Tips",
    keywords: ["removal company Rochester", "removal company Medway", "how to choose removals Kent"],
    caption: "Planning a move in Rochester or Medway? Before you book anyone, read this first. We share exactly what to check, what to ask — and the red flags that should make you walk away. Link in bio 👇\n\n#MedwayRemovals #KentRemovals #RochesterRemovals #MovingTips #RemovalCompany #HouseMove #Kent #Medway #Rochester #MovingDay #FullyInsured"
  },
  {
    day: 2,
    title: "The complete moving house checklist for Medway residents",
    slug: "moving-house-checklist-medway",
    category: "Checklist",
    keywords: ["moving house checklist Medway", "moving checklist Kent", "house move checklist Rochester"],
    caption: "8 weeks to moving day — here is your complete moving checklist for Medway. From the first box you pack to handing back the keys. Save this, you will need it 📋\n\n#MovingChecklist #MedwayRemovals #KentRemovals #MovingHouse #HouseMove #Rochester #Chatham #Gillingham #MovingTips #RemovalCompany"
  },
  {
    day: 3,
    title: "How much does a house removal cost in Rochester and Kent in 2025?",
    slug: "removal-costs-rochester-kent",
    category: "Cost Guide",
    keywords: ["removal cost Rochester", "how much does a removal cost Kent", "removal prices Medway 2025"],
    caption: "What does a house removal in Medway actually cost in 2025? Honest pricing guide by property size — no fluff, no hidden extras. From studio flats to 5-bedroom homes 💷\n\n#RemovalCosts #MedwayRemovals #KentRemovals #HouseRemoval #Rochester #MovingDay #FixedPrice #FullyInsured #RemovalCompany"
  },
  {
    day: 4,
    title: "Best areas to live in Medway — Rochester vs Chatham vs Gillingham compared",
    slug: "best-areas-medway-rochester-chatham-gillingham",
    category: "Area Guide",
    keywords: ["best areas Medway", "Rochester vs Chatham", "where to live Medway Kent"],
    caption: "Rochester, Chatham or Gillingham — which Medway town is right for you? We compare property prices, transport links and quality of life in each. Honest local insight from your Rochester removal team 🏘️\n\n#Medway #Rochester #Chatham #Gillingham #MovingToMedway #KentLife #WhereToLive #MedwayRemovals #KentRemovals"
  },
  {
    day: 5,
    title: "How to prepare for moving day — tips from our Rochester removal team",
    slug: "how-to-prepare-for-moving-day-rochester",
    category: "Moving Tips",
    keywords: ["prepare for moving day Rochester", "moving day tips Medway", "moving day advice Kent"],
    caption: "The night before your move — here is exactly what our Rochester team recommends you do to make tomorrow run smoothly. 8 things that make all the difference 🌙\n\n#MovingDay #MovingTips #MedwayRemovals #RochesterRemovals #KentRemovals #HouseMove #RemovalCompany #MovingAdvice"
  },
  {
    day: 6,
    title: "How far in advance should you book a removal company in Kent?",
    slug: "how-far-in-advance-book-removal-kent",
    category: "Moving Tips",
    keywords: ["how far in advance book removal Kent", "book removal company Medway", "removal booking lead time"],
    caption: "Book too late and your date will be gone. Book too early and things may change. Here is the ideal lead time for every season and move type in Medway and Kent 📅\n\n#BookingTips #MedwayRemovals #KentRemovals #RemovalCompany #MovingDay #Rochester #MovingHouse #HouseMove"
  },
  {
    day: 7,
    title: "Man and van vs full removal service — which do you need in Medway?",
    slug: "man-van-vs-removal-service-medway",
    category: "Moving Tips",
    keywords: ["man and van Medway", "man van vs removal service Kent", "man and van Rochester"],
    caption: "Man and van or full removal team — how do you know which one you actually need? We break down exactly when each option makes sense and what it will cost in Medway 🚐\n\n#ManAndVan #MedwayRemovals #KentRemovals #Rochester #RemovalService #MovingTips #HouseMove #MovingDay"
  },
  {
    day: 8,
    title: "Why professional packing is worth every penny on a house move",
    slug: "why-professional-packing-worth-it",
    category: "Packing",
    keywords: ["professional packing service Kent", "packing service Rochester", "removal packing Medway"],
    caption: "Most people try to pack themselves to save money. Here is why that often costs more in the end — and what our professional packing service actually includes 📦\n\n#PackingService #MedwayRemovals #KentRemovals #ProfessionalPacking #HouseMove #Rochester #MovingTips #RemovalCompany"
  },
  {
    day: 9,
    title: "How to pack fragile items safely for a house move in Kent",
    slug: "how-to-pack-fragile-items-safely",
    category: "Packing",
    keywords: ["pack fragile items move", "how to pack china glassware move", "packing tips Kent removal"],
    caption: "The right way to pack china, glassware, mirrors and artwork for a house move. Step by step from our Rochester packing team — with the exact materials you need 🫧\n\n#PackingTips #FragilePacking #MedwayRemovals #KentRemovals #PackingService #HouseMove #Rochester #MovingAdvice"
  },
  {
    day: 10,
    title: "Office relocation checklist — moving your business in Medway and Kent",
    slug: "office-relocation-checklist-medway-kent",
    category: "Checklist",
    keywords: ["office relocation Medway", "commercial removal Kent checklist", "office move Rochester"],
    caption: "Moving your business in Medway or Kent? A commercial relocation needs a completely different level of planning to a home move. Our complete office move checklist 🏢\n\n#OfficeMove #CommercialRemoval #MedwayRemovals #KentRemovals #Rochester #BusinessRelocation #OfficeRelocation"
  },
  {
    day: 11,
    title: "How to move a piano safely — advice from our Rochester removal team",
    slug: "how-to-move-piano-safely-rochester-kent",
    category: "Moving Tips",
    keywords: ["move piano Rochester", "piano removal Kent", "piano movers Medway"],
    caption: "Moving a piano is not a job for two people and a van. Here is what is actually involved in a safe piano removal in Kent — and why specialist equipment is essential 🎹\n\n#PianoRemoval #MedwayRemovals #KentRemovals #Rochester #MovingTips #SpecialistRemoval #HouseMove"
  },
  {
    day: 12,
    title: "What is goods in transit insurance and why does it matter for your move?",
    slug: "goods-in-transit-insurance-explained",
    category: "Moving Tips",
    keywords: ["goods in transit insurance", "removal insurance Kent", "insured removal company Medway"],
    caption: "Did you know your home contents insurance almost certainly does NOT cover your belongings during a removal? Here is what goods in transit insurance covers and why it matters 🛡️\n\n#InsuredRemovals #GoodsInTransit #MedwayRemovals #KentRemovals #FullyInsured #Rochester #RemovalCompany"
  },
  {
    day: 13,
    title: "How to move house with children — stress-free tips for Kent families",
    slug: "moving-house-with-children-kent",
    category: "Moving Tips",
    keywords: ["moving house with children Kent", "moving with kids Medway", "family removal Rochester"],
    caption: "Moving with children? Moving day is exciting for them and exhausting for you. Here are our best tips for keeping children safe, calm and happy on removal day in Medway 👨‍👩‍👧‍👦\n\n#MovingWithKids #FamilyMove #MedwayRemovals #KentRemovals #Rochester #MovingDay #MovingTips #HouseMove"
  },
  {
    day: 14,
    title: "Storage solutions during your house move in Rochester — what are your options?",
    slug: "storage-solutions-during-house-move-rochester",
    category: "Moving Tips",
    keywords: ["storage Rochester", "storage solutions Medway house move", "removal storage Kent"],
    caption: "Completion gap? Renovation underway? New build delayed? Storage is the answer. Here is what short and long-term storage options look like in Rochester and across Medway 📦\n\n#StorageSolutions #MedwayRemovals #KentRemovals #Rochester #SecureStorage #HouseMove #MovingDay"
  },
  {
    day: 15,
    title: "Moving to Maidstone — what you need to know before you relocate",
    slug: "moving-to-maidstone-guide",
    category: "Area Guide",
    keywords: ["moving to Maidstone", "relocate Maidstone Kent", "living in Maidstone guide"],
    caption: "Thinking of moving to Maidstone? Kent's county town has a lot to offer — but there are things you should know before you commit. Our honest local guide to life in Maidstone 🏙️\n\n#MovingToMaidstone #Maidstone #KentLife #MedwayRemovals #KentRemovals #AreaGuide #RelocationGuide"
  },
  {
    day: 16,
    title: "Moving to Gravesend — an honest guide to living in North Kent",
    slug: "moving-to-gravesend-guide",
    category: "Area Guide",
    keywords: ["moving to Gravesend", "living in Gravesend", "Ebbsfleet Garden City relocation"],
    caption: "Gravesend is growing fast. With Ebbsfleet Garden City expanding and HS1 to St Pancras in under 25 minutes, more people are choosing North Kent. Here is what to expect 🚅\n\n#MovingToGravesend #Gravesend #NorthKent #Ebbsfleet #MedwayRemovals #KentRemovals #AreaGuide"
  },
  {
    day: 17,
    title: "Moving to Canterbury — what to expect in Kent's cathedral city",
    slug: "moving-to-canterbury-guide",
    category: "Area Guide",
    keywords: ["moving to Canterbury Kent", "living in Canterbury", "relocate Canterbury guide"],
    caption: "Canterbury is one of the most desirable places to live in Kent. Historic, well-connected and full of character. Everything you need to know before you move here ⛪\n\n#MovingToCanterbury #Canterbury #KentLife #MedwayRemovals #KentRemovals #AreaGuide #RelocationGuide"
  },
  {
    day: 18,
    title: "Moving from London to Kent — the complete guide for 2025",
    slug: "moving-from-london-to-kent-guide",
    category: "Area Guide",
    keywords: ["moving from London to Kent", "London to Kent removal 2025", "relocating to Kent from London"],
    caption: "Thousands of people leave London for Kent every year. More space, lower prices, great schools, fast trains. Here is the complete guide to making the move in 2025 🚂\n\n#LondonToKent #MovingFromLondon #KentLife #MedwayRemovals #KentRemovals #Relocation #MovingGuide"
  },
  {
    day: 19,
    title: "Moving to Chatham — neighbourhood guide and what to expect",
    slug: "moving-to-chatham-neighbourhood-guide",
    category: "Area Guide",
    keywords: ["moving to Chatham", "living in Chatham Medway", "Chatham neighbourhood guide"],
    caption: "Chatham is one of Medway's most affordable and accessible towns with a housing market that offers real value. Our honest local guide to life in Chatham 🏘️\n\n#MovingToChatham #Chatham #Medway #MedwayRemovals #KentRemovals #AreaGuide #KentLife"
  },
  {
    day: 20,
    title: "How much does a long distance removal from Kent to London cost?",
    slug: "long-distance-removal-kent-london-cost",
    category: "Cost Guide",
    keywords: ["removal Kent to London cost", "long distance removal price Kent", "Rochester to London removal"],
    caption: "Moving from Kent to London or London to Kent? Here is an honest guide to what this costs in 2025 — and what affects the final price 💷\n\n#LongDistanceRemoval #KentToLondon #MedwayRemovals #KentRemovals #RemovalCosts #Rochester #MovingDay"
  },
  {
    day: 21,
    title: "Moving to Tonbridge or Tunbridge Wells — West Kent area guide",
    slug: "moving-to-tonbridge-tunbridge-wells-guide",
    category: "Area Guide",
    keywords: ["moving to Tonbridge", "moving to Tunbridge Wells", "West Kent relocation guide"],
    caption: "Tonbridge and Tunbridge Wells offer excellent schools, beautiful countryside and fast London trains. Everything you need to know about moving to West Kent 🌳\n\n#MovingToTonbridge #TunbridgeWells #WestKent #KentLife #MedwayRemovals #KentRemovals #AreaGuide"
  },
  {
    day: 22,
    title: "How to declutter before a house move — a practical guide for Kent families",
    slug: "how-to-declutter-before-house-move",
    category: "Moving Tips",
    keywords: ["declutter before house move", "decluttering tips moving Kent", "what to get rid of before moving"],
    caption: "The less you move, the less you pay. A room-by-room decluttering system for families in Medway and Kent — before the boxes even come out 🗑️\n\n#Declutter #MovingTips #MedwayRemovals #KentRemovals #HouseMove #Rochester #MovingDay #DeclutterTips"
  },
  {
    day: 23,
    title: "Moving house in winter — tips for cold weather removals in Kent",
    slug: "moving-house-in-winter-kent-tips",
    category: "Moving Tips",
    keywords: ["winter removal Kent", "moving house winter tips", "cold weather removal Medway"],
    caption: "Moving in winter has its own set of challenges — short days, cold weather and unpredictable conditions. Here is how to prepare for a smooth cold-weather move in Kent ❄️\n\n#WinterMove #MovingTips #MedwayRemovals #KentRemovals #Rochester #MovingDay #HouseMove #WinterMoving"
  },
  {
    day: 24,
    title: "How to update your address when you move home — the complete list",
    slug: "how-to-update-address-when-moving",
    category: "Checklist",
    keywords: ["update address moving house UK", "who to notify when moving Kent", "change of address checklist"],
    caption: "Moving house? Do not forget these 27 organisations that need your new address. A complete change of address checklist for UK homeowners and renters ✅\n\n#ChangeOfAddress #MovingChecklist #MedwayRemovals #KentRemovals #HouseMove #MovingTips #Rochester #MovingDay"
  },
  {
    day: 25,
    title: "What to do on moving day — an hour-by-hour guide for Medway families",
    slug: "what-to-do-on-moving-day-guide",
    category: "Checklist",
    keywords: ["what to do on moving day", "moving day guide Medway", "moving day tips Rochester"],
    caption: "Moving day can feel chaotic without a plan. Here is your hour-by-hour guide to moving day in Medway — from the moment the crew arrives to settling into your new home ⏰\n\n#MovingDay #MedwayRemovals #KentRemovals #Rochester #MovingGuide #HouseMove #MovingTips"
  },
  {
    day: 26,
    title: "How to handle a delayed completion on moving day in Kent",
    slug: "how-to-handle-delayed-completion-moving-day",
    category: "Moving Tips",
    keywords: ["delayed completion moving day", "completion delay Kent", "what happens if completion delayed"],
    caption: "Your solicitor calls on moving day — completion is delayed. It happens more often than you think. Here is exactly what to do and how to minimise the chaos 📞\n\n#CompletionDelay #MovingDay #MedwayRemovals #KentRemovals #Rochester #MovingTips #HouseMove #PropertyChain"
  },
  {
    day: 27,
    title: "Moving into a new build in Kent — what to expect and how to prepare",
    slug: "moving-into-new-build-kent",
    category: "Area Guide",
    keywords: ["moving into new build Kent", "new build removal Medway", "new build completion day Kent"],
    caption: "New build completions in Kent have their own unique quirks. Here is what completion day actually looks like at a new build and how to make your removal as smooth as possible 🏗️\n\n#NewBuild #NewBuildKent #MedwayRemovals #KentRemovals #Rochester #MovingDay #NewHome #HouseMove"
  },
  {
    day: 28,
    title: "How to get the best removal quote — 10 questions to ask every company",
    slug: "how-to-get-best-removal-quote-kent",
    category: "Cost Guide",
    keywords: ["best removal quote Kent", "removal quote questions to ask", "comparing removal quotes Medway"],
    caption: "Not all removal quotes cover the same things. Here are the 10 questions to ask before signing anything — and the answers that tell you whether a company can be trusted 🤝\n\n#RemovalQuote #MedwayRemovals #KentRemovals #Rochester #MovingTips #RemovalCompany #HouseMove"
  },
  {
    day: 29,
    title: "Top 10 mistakes people make when moving house in Medway and Kent",
    slug: "top-10-moving-mistakes-medway-kent",
    category: "Moving Tips",
    keywords: ["moving house mistakes Kent", "common removal mistakes Medway", "moving mistakes to avoid"],
    caption: "After 800+ removals across Medway and Kent, we have seen the same mistakes made again and again. Here are the top 10 — and exactly how to avoid every one of them 🚫\n\n#MovingMistakes #MedwayRemovals #KentRemovals #Rochester #MovingTips #HouseMove #RemovalCompany"
  },
  {
    day: 30,
    title: "Moving to Rochester — the complete newcomer's guide to living in the city",
    slug: "moving-to-rochester-guide",
    category: "Area Guide",
    keywords: ["moving to Rochester Kent", "living in Rochester guide", "relocate to Rochester Medway"],
    caption: "Rochester is one of Kent's most characterful and sought-after cities. A complete guide to moving to Rochester — neighbourhoods, schools, property and what life is really like here 🏰\n\n#MovingToRochester #Rochester #KentLife #Medway #MedwayRemovals #KentRemovals #AreaGuide #RelocationGuide"
  }
];

module.exports = CALENDAR;
