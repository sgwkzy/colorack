#!/usr/bin/env python3
from __future__ import annotations

import csv
import re
import sqlite3
import unicodedata
from pathlib import Path

import jaconv


ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "official_catalog.sqlite3"


SERIES_EN: dict[tuple[str, str], str] = {
    ("bornpaint", "ECサイト限定品"): "Online Store Exclusives",
    ("bornpaint", "クリヤ"): "Clear",
    ("bornpaint", "セット"): "Sets",
    ("bornpaint", "ハイパーソリッド"): "Hyper Solid",
    ("bornpaint", "プラ・サフ"): "Plastic Surfacer",
    ("bornpaint", "ベースカラー"): "Base Color",
    ("bornpaint", "ベースカラーII"): "Base Color II",
    ("bornpaint", "メッキ調"): "Plated Finish",
    ("bornpaint", "ラッカー系"): "Lacquer",
    ("bornpaint", "低侵食"): "Low Aggression",
    ("bornpaint", "溶剤"): "Solvents",
    ("finishers", "Finisher'sカラー"): "Finisher's Color",
    ("finishers", "カラー"): "Color",
    ("finishers", "カラー限定色"): "Limited Colors",
    ("finishers", "セット"): "Sets",
    ("finishers", "パール系統色"): "Pearl Colors",
    ("finishers", "基本色"): "Basic Colors",
    ("finishers", "専用色"): "Dedicated Colors",
    ("finishers", "蛍光カラー"): "Fluorescent Colors",
    ("finishers", "赤系統色"): "Red Colors",
    ("finishers", "金銀系統色"): "Gold and Silver Colors",
    ("gsi_creos", "Mr.カラー"): "Mr. Color",
    ("gsi_creos", "Mr.カラー AFV・戦車模型用特色"): "Mr. Color AFV and Tank Model Colors",
    ("gsi_creos", "Mr.カラー ラスキウス ストッキングカラー"): "Mr. Color Lascivus Stocking Colors",
    ("gsi_creos", "Mr.カラー 艦船模型用カラー"): "Mr. Color Ship Model Colors",
    ("gsi_creos", "Mr.カラー 飛行機模型用カラー"): "Mr. Color Aircraft Model Colors",
    ("gsi_creos", "Mr.カラーGGX 18ml サイズ"): "Mr. Color GGX 18ml Size",
    ("gsi_creos", "Mr.カラーGX"): "Mr. Color GX",
    ("gsi_creos", "Mr.カラーラスキウス"): "Mr. Color Lascivus",
    ("gsi_creos", "Mr.カラーラスキウスアウラ"): "Mr. Color Lascivus Aura",
    ("gsi_creos", "Mr.クリアカラ－GX"): "Mr. Clear Color GX",
    ("gsi_creos", "Mr.スーパーメタリック2"): "Mr. Super Metallic 2",
    ("gsi_creos", "アクリジョン"): "Acrysion",
    ("gsi_creos", "水性ホビーカラー"): "Aqueous Hobby Color",
    ("tamiya", "アクリル塗料ミニ"): "Acrylic Paint Mini",
    ("tamiya", "エナメル塗料"): "Enamel Paint",
    ("tamiya", "ラッカー塗料"): "Lacquer Paint",
    ("vallejo", "ボークス オリジナルカラー"): "Volks Original Colors",
    ("vallejo", "メタルカラー（アルコール系）"): "Metal Color (Alcohol Based)",
    ("vallejo", "モデルカラー"): "Model Color",
    ("vallejo", "モデルカラー メタリック"): "Model Color Metallic",
    ("vallejo", "モデルカラー（17ml）"): "Model Color (17ml)",
    ("vallejo", "蛍光カラー"): "Fluorescent Colors",
    ("gaianotes", "伝説巨神イデオンカラーシリーズ"): "Space Runaway Ideon Color Series",
    ("gaianotes", "創彩少女庭園×フレームアームズ・ガール カラー"): "Sousai Shojo Teien x Frame Arms Girl Color",
    ("gaianotes", "創彩少女庭園カラー"): "Sousai Shojo Teien Color",
    ("gaianotes", "勇者カラーシリーズ"): "Brave Series Color",
    ("gaianotes", "戦闘メカ ザブングルカラーシリーズ"): "Combat Mecha Xabungle Color Series",
    ("gaianotes", "機甲戦記ドラグナーカラーシリーズ"): "Metal Armor Dragonar Color Series",
    ("gaianotes", "機甲界ガリアン カラーシリーズ"): "Panzer World Galient Color Series",
    ("gaianotes", "聖戦士ダンバインカラーシリーズ"): "Aura Battler Dunbine Color Series",
    ("gaianotes", "蒼き鋼のアルペジオ -アルス・ノヴァ- カラーシリーズ"): "Arpeggio of Blue Steel -Ars Nova- Color Series",
    ("gaianotes", "重戦機エルガイムカラーシリーズ"): "Heavy Metal L-Gaim Color Series",
    ("gaianotes", "電脳戦機バーチャロン カラーシリーズ"): "Cyber Troopers Virtual-On Color Series",
    ("gaianotes", "G-08 調色工房 -ミキシングセット-"): "G-08 Mixing Workshop -Mixing Set-",
    ("gaianotes", "G-21 じぶん専用色見本帳"): "G-21 Personal Color Swatch Book",
}

SERIES_PHRASES = [
    ("シリーズ", "Series"),
    ("カラーセット", "Color Set"),
    ("カラー", "Color"),
    ("スプレー", "Spray"),
    ("メタリック", "Metallic"),
    ("パール", "Pearl"),
    ("クリアー", "Clear"),
    ("ミリタリー", "Military"),
    ("基本", "Basic"),
    ("溶剤", "Solvent"),
    ("筆", "Brush"),
    ("ツール", "Tool"),
    ("デカール", "Decal"),
    ("サーフェイサー", "Surfacer"),
    ("プライマー", "Primer"),
    ("プレミアム", "Premium"),
    ("フレッシュ", "Flesh"),
    ("蛍光", "Fluorescent"),
    ("純色", "Primary"),
    ("鉄道模型用", "Railroad Model"),
    ("用", "For"),
    ("小", "Small"),
    ("中", "Medium"),
    ("大", "Large"),
    ("溶剤", "Solvent"),
    ("うすめ液", "Thinner"),
    ("薄め液", "Thinner"),
]

NAME_PHRASES = [
    ("つや消し", "Flat"),
    ("つやけし", "Flat"),
    ("半光沢", "Semi Gloss"),
    ("光沢", "Gloss"),
    ("透明", "Transparent"),
    ("蛍光", "Fluorescent"),
    ("メタリック", "Metallic"),
    ("クリアー", "Clear"),
    ("クリヤー", "Clear"),
    ("フラット", "Flat"),
    ("スーパースムース", "Super Smooth"),
    ("スーパークリアー", "Super Clear"),
    ("スーパーファイン", "Super Fine"),
    ("スターブライト", "Star Bright"),
    ("プレミアム", "Premium"),
    ("ファンデーション", "Foundation"),
    ("ピュア", "Pure"),
    ("ブライト", "Bright"),
    ("ライト", "Light"),
    ("ダーク", "Dark"),
    ("ディープ", "Deep"),
    ("ミディアム", "Medium"),
    ("ニュートラル", "Neutral"),
    ("オリーブドラブ", "Olive Drab"),
    ("ミッドナイト", "Midnight"),
    ("エアクラフト", "Aircraft"),
    ("コクピット", "Cockpit"),
    ("レドーム", "Radome"),
    ("インテリア", "Interior"),
    ("グランプリ", "Grand Prix"),
    ("シャイン", "Shine"),
    ("セール", "Sail"),
    ("スモーク", "Smoke"),
    ("タイヤ", "Tire"),
    ("ウッド", "Wood"),
    ("マホガニー", "Mahogany"),
    ("エメラルド", "Emerald"),
    ("コバルト", "Cobalt"),
    ("ターコイズ", "Turquoise"),
    ("チタン", "Titanium"),
    ("ステンレス", "Stainless"),
    ("ジュラルミン", "Duralumin"),
    ("クローム", "Chrome"),
    ("フォーミュラ", "Formula"),
    ("レーシング", "Racing"),
    ("ジャーマン", "German"),
    ("ロシアン", "Russian"),
    ("イタリアン", "Italian"),
    ("フレンチ", "French"),
    ("カーボン", "Carbon"),
    ("マット", "Matte"),
    ("リキッド", "Liquid"),
    ("ガイアカラー", "Gaia Color"),
    ("ガイアノーツ", "Gaianotes"),
    ("ガイアセメント", "Gaia Cement"),
    ("イージーペインター", "Easy Painter"),
    ("スペアボトル", "Spare Bottle"),
    ("スペア", "Spare"),
    ("ツールウォッシュ", "Tool Wash"),
    ("ブラシマスター", "Brush Master"),
    ("メタリックマスター", "Metallic Master"),
    ("プロユースシンナー", "Pro Use Thinner"),
    ("フィニッシュマスター", "Finish Master"),
    ("ユニフォーミティカッター", "Uniformity Cutter"),
    ("センターポインター", "Center Pointer"),
    ("マスキングシート", "Masking Sheet"),
    ("ペーパーパレット", "Paper Palette"),
    ("ペイントカップ", "Paint Cup"),
    ("スターリング", "Stirring"),
    ("メッシュストレーナー", "Mesh Strainer"),
    ("メカサフ", "Mecha Surfacer"),
    ("ドライブラシ", "Dry Brush"),
    ("エリア", "Area"),
    ("イベント", "Event"),
    ("コンパウンド", "Compound"),
    ("サイズ", "Size"),
    ("フィニッシャーズ", "Finishers"),
    ("フィニッシュカラー", "Finish Color"),
    ("フィニッシュクリヤ", "Finish Clear"),
    ("ベースカラー", "Base Color"),
    ("ボーンクリーナー", "Born Cleaner"),
    ("ボーンペイント", "Born Paint"),
    ("ボーン", "Born"),
    ("レインボーン", "Rainborn"),
    ("マイカ", "Mica"),
    ("シアン", "Cyan"),
    ("マゼンタ", "Magenta"),
    ("ラッカー", "Lacquer"),
    ("アクリル", "Acrylic"),
    ("エナメル", "Enamel"),
    ("アルコール", "Alcohol"),
    ("ペイント", "Paint"),
    ("リターダー", "Retarder"),
]

COLOR_WORDS = [
    ("ホワイト", "White"), ("白", "White"),
    ("ブラック", "Black"), ("黒", "Black"),
    ("レッド", "Red"), ("赤", "Red"),
    ("イエロー", "Yellow"), ("黄", "Yellow"),
    ("ブルー", "Blue"), ("青", "Blue"),
    ("グリーン", "Green"), ("緑", "Green"),
    ("ブラウン", "Brown"), ("茶", "Brown"),
    ("シルバー", "Silver"), ("銀", "Silver"),
    ("ゴールド", "Gold"), ("金", "Gold"),
    ("カッパー", "Copper"), ("銅", "Copper"),
    ("オレンジ", "Orange"), ("橙", "Orange"),
    ("ピンク", "Pink"), ("桃", "Pink"),
    ("パープル", "Purple"), ("紫", "Purple"),
    ("バイオレット", "Violet"),
    ("グレー", "Gray"), ("グレイ", "Gray"), ("灰色", "Gray"),
    ("カーキ", "Khaki"),
    ("マルーン", "Maroon"),
    ("クリーム", "Cream"),
    ("アイボリー", "Ivory"),
    ("ベージュ", "Beige"),
    ("サンド", "Sand"),
    ("スカイ", "Sky"),
    ("ネイビー", "Navy"),
]

KANJI_PHRASES = [
    ("日本海軍", "Japanese Navy"),
    ("日本陸軍", "Japanese Army"),
    ("海軍", "Navy"),
    ("陸軍", "Army"),
    ("空軍", "Air Force"),
    ("自衛隊", "Self-Defense Force"),
    ("航空", "Aviation"),
    ("艦船", "Ship"),
    ("軍艦色", "Warship Color"),
    ("機体内部色", "Interior Color"),
    ("明灰白色", "Light Gray White"),
    ("暗緑色", "Dark Green"),
    ("濃緑色", "Dark Green"),
    ("明灰緑色", "Light Gray Green"),
    ("薄茶色", "Light Brown"),
    ("赤鉄色", "Red Iron"),
    ("黒鉄色", "Dark Iron"),
    ("焼鉄色", "Burnt Iron"),
    ("青竹色", "Aotake"),
    ("艦底色", "Hull Red"),
    ("土地色", "Earth"),
    ("草色", "Grass Green"),
    ("枯草色", "Dry Grass"),
    ("緑色", "Green"),
    ("茶色", "Brown"),
    ("黄土色", "Ochre"),
    ("薄松葉色", "Light Pine Green"),
    ("濃松葉色", "Dark Pine Green"),
    ("船体色", "Hull Color"),
    ("船底色", "Hull Red"),
    ("下地", "Primer"),
    ("低侵食", "Low Aggression"),
    ("専用", "Dedicated"),
    ("限定色", "Limited Color"),
    ("基本色", "Basic Color"),
    ("基本", "Basic"),
    ("色ノ源", "Color Source"),
    ("用", "For"),
    ("小", "Small"),
    ("中", "Medium"),
    ("大", "Large"),
    ("特大", "Extra Large"),
    ("入り", "Included"),
    ("系", "Based"),
    ("調色", "Mixing"),
    ("塗料", "Paint"),
    ("うすめ液", "Thinner"),
    ("薄め液", "Thinner"),
    ("溶剤", "Solvent"),
    ("接着剤", "Adhesive"),
    ("低粘度", "Low Viscosity"),
    ("速乾性", "Fast Drying"),
    ("瞬間", "Instant"),
    ("精密綿棒", "Precision Cotton Swab"),
    ("綿棒", "Cotton Swab"),
    ("砥石", "Grinding Stone"),
    ("番", "Grit"),
    ("棒", "Rod"),
    ("刃", "Blade"),
    ("替刃", "Replacement Blade"),
    ("両面テープ", "Double-Sided Tape"),
    ("多用途", "Multipurpose"),
    ("山型", "Mountain-Shaped"),
    ("波型", "Wave-Shaped"),
    ("円形", "Circular"),
    ("付き", "With"),
    ("型取り", "Molding"),
    ("樹脂", "Resin"),
    ("複製", "Duplication"),
    ("界隈", "Area"),
    ("おうち", "Home"),
    ("超微粒子", "Ultrafine Particle"),
    ("微粒子", "Fine Particle"),
    ("平筆", "Flat Brush"),
    ("面相筆", "Detail Brush"),
    ("極細", "Extra Fine"),
    ("筆", "Brush"),
    ("流し込み", "Extra Thin"),
    ("強力", "Strong"),
    ("樹脂入り", "Resin-Infused"),
    ("高粘度", "High Viscosity"),
    ("大徳用", "Value Size"),
    ("上塗り", "Overcoat"),
    ("木目", "Wood Grain"),
    ("真鍮色", "Brass"),
    ("履帯色", "Track Color"),
    ("迷彩", "Camouflage"),
    ("戦車", "Tank"),
    ("日本軍", "Japanese Army"),
    ("ドイツ軍", "German Army"),
    ("アメリカ軍", "U.S. Army"),
    ("イギリス軍", "British Army"),
    ("ロシア軍", "Russian Army"),
    ("軍", "Army"),
    ("ユニフォーム", "Uniform"),
    ("フィールド", "Field"),
    ("カモフラージュ", "Camouflage"),
    ("甲板色", "Deck Color"),
    ("木甲板色", "Wooden Deck Tan"),
    ("リノリウム", "Linoleum"),
    ("工廠", "Arsenal"),
    ("標準色", "Standard Color"),
    ("横須賀", "Yokosuka"),
    ("舞鶴", "Maizuru"),
    ("佐世保", "Sasebo"),
    ("呉", "Kure"),
    ("陸上", "Ground"),
    ("現用", "Modern"),
    ("退色", "Faded"),
    ("以降", "And Later"),
    ("年", ""),
    ("半島", "Peninsula"),
    ("外舷", "Ship Side"),
    ("号色", "Color"),
    ("紅色", "Crimson"),
    ("朱色", "Vermilion"),
    ("あずき色", "Azuki Red"),
    ("ねずみ色", "Mouse Gray"),
    ("すみれ色", "Violet"),
    ("よもぎ色", "Mugwort Green"),
    ("みず色", "Light Blue"),
    ("空色", "Sky Blue"),
    ("浅葱色", "Light Blue Green"),
    ("亜麻色", "Flaxen"),
    ("栗毛色", "Chestnut"),
    ("緋色", "Scarlet"),
    ("白雪色", "Snow White"),
    ("濡烏", "Wet Black"),
    ("鴇羽色", "Tokiwa Pink"),
    ("育竹色", "Aotake"),
    ("カウリング色", "Cowling Color"),
    ("三菱系", "Mitsubishi Type"),
    ("中島系", "Nakajima Type"),
    ("川崎系", "Kawasaki Type"),
    ("川西系", "Kawanishi Type"),
    ("三義系", "Mitsubishi Type"),
    ("三蓋", "Mitsubishi Type"),
    ("濃", "Dark"),
    ("暗", "Dark"),
    ("明灰", "Light Gray"),
    ("灰緑", "Gray Green"),
    ("薄", "Light"),
    ("黄橙", "Yellow Orange"),
    ("黄土", "Ochre"),
    ("枯", "Dry"),
    ("土", "Earth"),
    ("赤鉄", "Red Iron"),
    ("黒鉄", "Dark Iron"),
    ("零式艦上戦闘機", "Type Zero Carrier Fighter"),
    ("零戦", "Zero Fighter"),
    ("直販", "Direct Sales"),
    ("限定", "Limited"),
    ("偏光", "Prismatic"),
    ("メッキ調", "Plated Finish"),
    ("お試し", "Trial"),
    ("強化剤", "Hardener"),
]

EXACT_NAMES = {
    "GSIクレオス Mr.Hobby": "GSI Creos Mr. Hobby",
    "Mr.カラー |": "Mr. Color",
    "色ノ源": "Color Source",
    "水性カラー アクリジョン": "Acrysion Water-Based Color",
    "アクリジョン": "Acrysion",
}

POST_REPLACEMENTS = [
    ("色Setto", "Color Set"),
    ("setto", " Set"),
    ("Kara-Setto", "Color Set"),
    ("Kara-Pate", "Color Putty"),
    ("SPKara-", "SP Color "),
    ("Kara-", "Color "),
    ("Kara", "Color"),
    ("Setto", "Set"),
    ("Haundo", "Hound"),
    ("Su-Pa", "Super"),
    ("Sa-Feisa", "Surfacer"),
    ("Pa-Ru", "Pearl"),
    ("Ruutoramarin", "Ultramarine"),
    ("Ko-Rudo", "Cold"),
    ("Bibiddo", "Vivid"),
    ("Ro-Zu", "Rose"),
    ("Ma-Zu", "Mars"),
    ("Pe-Ru", "Pale"),
    ("Ori-Bu", "Olive"),
    ("Furesshu", "Flesh"),
    ("To-N", "Tone"),
    ("Semigurosu", "Semi Gloss"),
    ("Ganmetaru", "Gunmetal"),
    ("Be-Su", "Base"),
    ("Deza-To", "Desert"),
    ("Roiyaru", "Royal"),
    ("Ba-Mirion", "Vermilion"),
    ("Suka-Retto", "Scarlet"),
    ("Uo-Mu", "Warm"),
    ("Ka-Main", "Carmine"),
    ("Go-Ruden", "Golden"),
    ("Sutanda-Do", "Standard"),
    ("Inta-Mideieito", "Intermediate"),
    ("Ko-Raru", "Coral"),
    ("Suchi-Ru", "Steel"),
    ("Go-Suto", "Ghost"),
    ("Azu-Ru", "Azure"),
    ("Ne-Bi", "Navy"),
    ("Sure-To", "Slate"),
    ("Pa-Ku", "Park"),
    ("Rapa-Ru", "Pearl"),
    ("O-Ra", "Aura"),
    ("Sutore-Kingu", "Streaking"),
    ("Angyura", "Angular"),
    ("No-Tsu", "Notes"),
    ("Redeisshu", "Reddish"),
    ("Bure-Do", "Blade"),
    ("Suteikku", "Stick"),
    ("Taipu", "Type"),
    ("Masuta-", "Master "),
    ("Masuta", "Master"),
    ("Burashi", "Brush"),
    ("burashi", " Brush"),
    ("Kuririn", "Cleaning"),
    ("Kuriya", "Clear"),
    ("Sukuea", "Square"),
    ("Mikishingu", "Mixing"),
    ("Mixingsetto", "Mixing Set"),
    ("Mikishîngu", "Mixing"),
    ("Fainchu-Ningu", "Fine Tuning"),
    ("Fainchu", "Fine Tu"),
    ("Patesuteikku", "Putty Stick"),
    ("Pate", "Putty"),
    ("Puraima", "Primer"),
    ("Puraimari", "Primary"),
    ("Purasuchikku", "Plastic"),
    ("Katta-", "Cutter"),
    ("Purasu", "Plus"),
    ("Rakka-", "Lacquer "),
    ("Akuriru", "Acrylic"),
    ("Enameru", "Enamel"),
    ("Shinna", "Thinner"),
    ("Rimu-Ba", "Remover"),
    ("Uosshu", "Wash"),
    ("Burashiuosshu", "Brush Wash"),
    ("Ni-Dorukyappu", "Needle Cap"),
    ("Okutopaddo", "Octo Pad"),
    ("Masukinguko-To", "Masking Coat"),
    ("Handouosshu", "Hand Wash"),
    ("Eakuri-Ningu", "Air Cleaning"),
    ("A-Teifisharuho-Ru", "Artificial Hole"),
    ("Kurassha-Jou", "Crusher Joe"),
    ("Ko-Shon", "Caution"),
    ("Takuteikaru", "Tactical"),
    ("Re-Beru", "Label"),
    ("Daguramu", "Dougram"),
    ("Haisuku-Ru", "High School"),
    ("Furi-To", "Fleet"),
    ("Fure-Mua-Muzu", "Frame Arms"),
    ("Fure-Mumyu-Jikku", "Frame Music"),
    ("Fure-Mu", "Frame"),
    ("Purizumu", "Prism"),
    ("Botomuzu", "Votoms"),
    ("Mekatoroui-Go", "Mechatro WeGo"),
    ("Riarufi-Ru", "Real Feel"),
    ("Gaiataipu", "Gaia Type"),
    ("Ka-Torijji", "Cartridge"),
    ("Ga-Ru", "Girl"),
    ("Shojo", "Shojo"),
    ("Ra-ji", "Large"),
    ("Suma-To", "Smart"),
    ("Kusabi", "Wedge"),
    ("Kyappu", "Cap"),
    ("Gurau", "Grau"),
    ("Guryun", "Grun"),
    ("Doitsu", "German"),
    ("Jinku Kuromeito", "Zinc Chromate"),
    ("Fareho Purimura", "Vallejo Primer"),
    ("Deka-Ru", "Decal"),
    ("deka-Ru", " Decal"),
    ("Beneton", "Benetton"),
    ("Uo-Ka", "Walker"),
    ("ECSaito", "Online Store"),
    ("Rinyu-Aruedeishon", "Renewal Edition"),
    ("Hoiru", "Foil"),
    ("Horoguramu", "Hologram"),
    ("Pearlma-Zu", "Pearl Mars"),
    ("Supe-Sushippu", "Spaceship"),
    ("Supa-Kuringu", "Sparkling"),
    ("Be-Shikkusukinto-N", "Basic Skin Tone"),
    ("Sani-Sukinto-N", "Sunny Skin Tone"),
    ("Sa-Monro-Zu", "Salmon Rose"),
    ("O-Rudoro-Zu", "Old Rose"),
    ("Okkusufo-Do", "Oxford"),
    ("Ba-Ntoanba", "Burnt Umber"),
    ("Oiri-Steel", "Oily Steel"),
    ("Nachurarusuchi-Ru", "Natural Steel"),
    ("Ri-Fu", "Leaf"),
    ("Purakuri-Na-Plus", "Plastic Cleaner Plus"),
    ("Kuikkuha-Dosupure", "Quick Hard Spray"),
    ("Purarikabari-Kitto", "Plastic Recovery Kit"),
    ("Gaiamaruchipuraima-Adobansu", "Gaia Multi Primer Advance"),
    ("Faburikku", "Fabric"),
    ("Furugurosu", "Full Gloss"),
    ("kuriya", " Clear"),
    ("Shi-Saido", "Seaside"),
    ("Uesuto", "West"),
    ("Janguru", "Jungle"),
    ("Pepa-Minto", "Peppermint"),
    ("Rabenda", "Lavender"),
    ("Foresuto", "Forest"),
    ("Fain", "Fine"),
    ("Kurimuzon", "Crimson"),
    ("Furosuto", "Frost"),
    ("A-Su", "Earth"),
    ("O-Ka", "Ochre"),
    ("Midorusuto-N", "Middle Stone"),
    ("O-Rudo", "Old"),
    ("Suto-N", "Stone"),
    ("O-Shan", "Ocean"),
    ("Fleshto-N", "Flesh Tone"),
    ("Tana-Su", "Tan Earth"),
    ("Maikuroserabure-Do", "Micro Ceramic Blade"),
    ("Serabure-Do", "Ceramic Blade"),
    ("UVJieruguru-S", "UV Gel Glue S"),
    ("Se-Bururaina", "Sable Liner"),
    ("Sha-Shi", "Chassis"),
    ("Aurape-Ru", "Aura Pale"),
    ("O-Pearlpe-Ru", "Aura Pearl Pale"),
    ("Evava-Mirion", "Eva Vermilion"),
    ("A-Ma", "Armor"),
    ("Purachinaburondobe-Su", "Platinum Blonde Base"),
    ("Burondobe-Su", "Blonde Base"),
    ("Hekisafure-Muganmetaru", "Hexa Frame Gunmetal"),
    ("Hekisadeza-To", "Hexa Desert"),
    ("Ori-Fuguryun", "Olivgrun"),
    ("Ro-To", "Rot"),
    ("Garasupa-Ru", "Glass Pearl"),
    ("Pechiko-To", "Petticoat"),
    ("Pearlko-Rudo", "Pearl Cold"),
    ("Pearlro-Zu", "Pearl Rose"),
    ("Coldsuchi-Ru", "Cold Steel"),
    ("Super-Hevi", "Super Heavy"),
    ("Kurafutasa-Feisa", "Crafter Surfacer"),
    ("Shi-Ruzu", "Seals"),
    ("Chokore-To", "Chocolate"),
    ("Super-Shieru", "Super Shell"),
    ("Sa-Mon", "Salmon"),
    ("Ha-Su", "Haas"),
    ("Asutonma-Chin", "Aston Martin"),
    ("Beibi-Nachuraru", "Baby Natural"),
    ("Fera-Ri", "Ferrari"),
    ("Fe-Deddo", "Faded"),
    ("Inta-Medeieito", "Intermediate"),
    ("Fa-N", "Fern"),
    ("Ba-Ntokadomiumu", "Burnt Cadmium"),
    ("Ba-Nto", "Burnt"),
    ("Mira-Ju", "Mirage"),
    ("Goldenori-Bu", "Golden Olive"),
    ("Chokore-Toburan", "Chocolate Brown"),
    ("Ta-Kushi", "Dark Sea"),
    ("Maru-N", "Maroon"),
    ("Kyarakuta-Furetsushu", "Character Flesh"),
    ("Kyarakuta-Flesh", "Character Flesh"),
    ("Su-Ba", "Super"),
    ("Sumu-Su", "Smooth"),
    ("Ku-Ru", "Cool"),
    ("GXKuriaru-Ju", "GX Clear Rouge"),
    ("GXKuriapi-Kokku", "GX Clear Peacock"),
    ("Super-Ricchi", "Super Rich"),
    ("Pearlbe-Su", "Pearl Base"),
    ("Re-Da", "Rader"),
    ("Te-Ashubarutsu", "Teerschwarz"),
    ("Sa-Monbinku", "Salmon Pink"),
    ("Ba-Ru", "Pearl"),
    ("Toppuko-To", "Topcoat"),
    ("UVKattosumu-Su", "UV Cut Smooth"),
    ("Pi-Chi", "Peach"),
    ("Sumu-Supa-Ruko-To", "Smooth Pearl Coat"),
    ("Surfacer-Evo", "Surfacer Evo"),
    ("Konku", "Concentrated"),
    ("Anda-", "Under "),
    ("Buronzu", "Bronze"),
    ("Mira-", "Mirror "),
    ("Arumu", "Aluminum"),
    ("Brassto", "Blast"),
    ("Burasu", "Brass"),
    ("Gray Zu", "Graze"),
    ("Nachuraru", "Natural"),
    ("Gurosu", "Gloss"),
    ("Shi-", "Sea "),
    ("O-Pearl", "Aura Pearl"),
    ("Yo-Kofuresshushado", "Yoko Flesh Shadow"),
    ("Yo-Kofuresshu", "Yoko Flesh"),
    ("Yo-Koheakara", "Yoko Hair Color"),
    ("Yo-Ko", "Yoko"),
    ("Ha-Man", "Hermann"),
    ("Su-Ji", "Susie"),
    ("Ba-Ri", "Barley"),
    ("Smoothpa-Ruko-To", "Smooth Pearl Coat"),
]


def ascii_cleanup(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("・", " ").replace("･", " ").replace("_", " ")
    text = text.replace("【", " ").replace("】", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def kata_to_words(text: str) -> str:
    # jaconv handles katakana loanwords reasonably enough for reviewable labels.
    def repl(match: re.Match[str]) -> str:
        value = match.group(0)
        roman = jaconv.kata2alphabet(value).replace("ー", "")
        return roman.title() if roman else value

    return re.sub(r"[ァ-ヴー]+", repl, text)


def post_cleanup(text: str) -> str:
    value = text
    for src, dst in POST_REPLACEMENTS:
        value = value.replace(src, dst)
    for src, dst in POST_REPLACEMENTS:
        value = re.sub(rf"\b{re.escape(src)}\b", dst, value)
    value = re.sub(r"\bSu\s+Pa\b", "Super", value)
    value = re.sub(r"\bSemi\s+Gloss\b", "Semi Gloss", value)
    value = re.sub(r"\s+", " ", value).strip(" -")
    return value


def phrase_translate(text: str) -> str:
    value = ascii_cleanup(text)
    for src, dst in NAME_PHRASES + COLOR_WORDS + KANJI_PHRASES:
        value = value.replace(src, f" {dst} ")
    value = kata_to_words(value)
    value = re.sub(r"\(([^)]*)\)", r" \1 ", value)
    value = re.sub(r"[|｜]+", " ", value)
    value = re.sub(r"\s+", " ", value).strip(" -")
    return post_cleanup(value)


def translate_name(name_ja: str) -> str:
    name_ja = name_ja.strip()
    if name_ja in EXACT_NAMES:
        return EXACT_NAMES[name_ja]
    return phrase_translate(name_ja)


def translate_series(brand: str, series_ja: str) -> str:
    if (brand, series_ja) in SERIES_EN:
        return SERIES_EN[(brand, series_ja)]
    value = ascii_cleanup(series_ja)
    for src, dst in SERIES_PHRASES + NAME_PHRASES + COLOR_WORDS + KANJI_PHRASES:
        value = value.replace(src, f" {dst} ")
    return post_cleanup(re.sub(r"\s+", " ", kata_to_words(value)).strip())


def has_japanese(text: str) -> bool:
    return bool(re.search(r"[\u3040-\u30ff\u3400-\u9fff]", text))


def main() -> int:
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row

    product_log = []
    for row in conn.execute(
        "SELECT catalog_code, name_ja FROM official_products WHERE name_ja IS NOT NULL AND trim(name_ja) <> ''"
    ):
        name_en = translate_name(row["name_ja"])
        conn.execute(
            "UPDATE official_products SET name_en = ? WHERE catalog_code = ?",
            (name_en, row["catalog_code"]),
        )
        product_log.append(
            {
                "catalog_code": row["catalog_code"],
                "name_ja": row["name_ja"],
                "name_en": name_en,
                "needs_review": "1" if has_japanese(name_en) else "0",
            }
        )

    series_log = []
    for row in conn.execute("SELECT brand, series_ja FROM official_series ORDER BY brand, series_ja"):
        series_en = translate_series(row["brand"], row["series_ja"])
        conn.execute(
            """
            UPDATE official_series
            SET series_en = ?, source = COALESCE(source, 'rule_generated'), updated_at = CURRENT_TIMESTAMP
            WHERE brand = ? AND series_ja = ?
            """,
            (series_en, row["brand"], row["series_ja"]),
        )
        series_log.append(
            {
                "brand": row["brand"],
                "series_ja": row["series_ja"],
                "series_en": series_en,
                "needs_review": "1" if has_japanese(series_en) else "0",
            }
        )

    conn.commit()

    out_product = ROOT / "data" / "english_name_generation_review.csv"
    with out_product.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["catalog_code", "name_ja", "name_en", "needs_review"])
        writer.writeheader()
        writer.writerows(product_log)

    out_series = ROOT / "data" / "english_series_generation_review.csv"
    with out_series.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["brand", "series_ja", "series_en", "needs_review"])
        writer.writeheader()
        writer.writerows(series_log)

    print(f"products={len(product_log)} review={sum(r['needs_review'] == '1' for r in product_log)} {out_product}")
    print(f"series={len(series_log)} review={sum(r['needs_review'] == '1' for r in series_log)} {out_series}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
