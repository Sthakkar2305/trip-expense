"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Plus, Calculator, Users, ArrowRight, Trash2, Receipt, LogOut, KeyRound, Wallet, ArrowDownCircle, ArrowUpCircle } from "lucide-react"
import jsPDF from "jspdf"
import { InstallButton } from "@/components/install-button"

// Firebase imports
import { db } from "@/lib/firebase"
import { collection, addDoc, deleteDoc, doc, onSnapshot, query, orderBy, serverTimestamp } from "firebase/firestore"

interface ExpenseEntry {
  id: string
  name: string
  amount: number
  createdAt?: any
}

interface PoolTransaction {
  id: string
  description: string
  amountPerPerson: number
  type: 'COLLECTION' | 'EXPENSE'
  createdAt?: any
}

interface PersonTotal {
  name: string
  total: number
  balance: number
  shouldPay: number
}

interface Settlement {
  from: string
  to: string
  amount: number
}

export default function TripSplit() {
  const [tripCode, setTripCode] = useState("")
  const [activeTrip, setActiveTrip] = useState("")
  const [tripMode, setTripMode] = useState<'normal' | 'pool' | null>(null)
  
  // Normal Mode State
  const [expenses, setExpenses] = useState<ExpenseEntry[]>([])
  const [currentName, setCurrentName] = useState("")
  const [currentAmount, setCurrentAmount] = useState("")
  const [calculated, setCalculated] = useState(false)

  // Pool Mode State
  const [poolTransactions, setPoolTransactions] = useState<PoolTransaction[]>([])
  const [poolDesc, setPoolDesc] = useState("")
  const [poolAmount, setPoolAmount] = useState("")

  // Check for saved trip session on load
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedTrip = localStorage.getItem("tripSplit-activeTrip")
      const savedMode = localStorage.getItem("tripSplit-tripMode") as 'normal' | 'pool' | null
      if (savedTrip && savedMode) {
        setActiveTrip(savedTrip)
        setTripMode(savedMode)
      }
    }
  }, [])

  // Firebase Real-time Listeners
  useEffect(() => {
    if (!activeTrip || !tripMode) return;

    if (tripMode === 'normal') {
      const q = query(collection(db, "trips", activeTrip, "expenses"), orderBy("createdAt", "asc"));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        setExpenses(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as ExpenseEntry[]);
        if (calculated) setCalculated(false); 
      });
      return () => unsubscribe();
    } 
    
    if (tripMode === 'pool') {
      const q = query(collection(db, "trips", activeTrip, "pool_transactions"), orderBy("createdAt", "asc"));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        setPoolTransactions(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as PoolTransaction[]);
      });
      return () => unsubscribe();
    }
  }, [activeTrip, tripMode]);

  const joinTrip = (mode: 'normal' | 'pool') => {
    if (tripCode.trim().length >= 3) {
      const normalizedCode = tripCode.trim().toUpperCase()
      setActiveTrip(normalizedCode)
      setTripMode(mode)
      localStorage.setItem("tripSplit-activeTrip", normalizedCode)
      localStorage.setItem("tripSplit-tripMode", mode)
      setTripCode("")
    } else {
      alert("Trip code must be at least 3 characters.")
    }
  }

  const leaveTrip = () => {
    setActiveTrip("")
    setTripMode(null)
    setExpenses([])
    setPoolTransactions([])
    setCalculated(false)
    localStorage.removeItem("tripSplit-activeTrip")
    localStorage.removeItem("tripSplit-tripMode")
  }

  // --- NORMAL MODE FUNCTIONS ---
  const addNormalExpense = async () => {
    if (currentName.trim() && currentAmount && Number.parseFloat(currentAmount) > 0) {
      await addDoc(collection(db, "trips", activeTrip, "expenses"), {
        name: currentName.trim(),
        amount: Number.parseFloat(currentAmount),
        createdAt: serverTimestamp()
      });
      setCurrentName("")
      setCurrentAmount("")
    }
  }

  const removeNormalExpense = async (id: string) => {
    await deleteDoc(doc(db, "trips", activeTrip, "expenses", id));
  }

  const getPersonTotals = (): PersonTotal[] => {
    const personMap = new Map<string, number>()
    const originalNames = new Map<string, string>()

    expenses.forEach((expense) => {
      const normalizedName = expense.name.toLowerCase().trim()
      const currentTotal = personMap.get(normalizedName) || 0
      personMap.set(normalizedName, currentTotal + expense.amount)
      if (!originalNames.has(normalizedName)) originalNames.set(normalizedName, expense.name.trim())
    })

    const totalAmount = Array.from(personMap.values()).reduce((sum, amount) => sum + amount, 0)
    const sharePerPerson = personMap.size > 0 ? totalAmount / personMap.size : 0

    return Array.from(personMap.entries()).map(([normalizedName, total]) => ({
      name: originalNames.get(normalizedName) || normalizedName,
      total,
      shouldPay: sharePerPerson,
      balance: total - sharePerPerson,
    }))
  }

  const personTotals = getPersonTotals()
  const normalTotalAmount = personTotals.reduce((sum, person) => sum + person.total, 0)
  const normalSharePerPerson = personTotals.length > 0 ? normalTotalAmount / personTotals.length : 0

  const calculateSettlements = (): Settlement[] => {
    const settlements: Settlement[] = []
    const creditors = personTotals.filter((person) => person.balance > 0.01).sort((a, b) => b.balance - a.balance)
    const debtors = personTotals.filter((person) => person.balance < -0.01).sort((a, b) => a.balance - b.balance)

    let i = 0, j = 0
    while (i < creditors.length && j < debtors.length) {
      const creditor = { ...creditors[i] }
      const debtor = { ...debtors[j] }
      const amount = Math.min(creditor.balance, Math.abs(debtor.balance))

      if (amount > 0.01) {
        settlements.push({ from: debtor.name, to: creditor.name, amount: Math.round(amount * 100) / 100 })
        creditor.balance -= amount
        debtor.balance += amount
      }
      if (Math.abs(creditor.balance) < 0.01) i++
      if (Math.abs(debtor.balance) < 0.01) j++
    }
    return settlements
  }

  const generateNormalSettlementPDF = () => {
    const doc = new jsPDF()
    const settlements = calculateSettlements()
    doc.setFontSize(20)
    doc.text(`TripSplit - ${activeTrip} Settlements`, 20, 30)
    doc.setFontSize(12)
    doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 20, 45)
    doc.text(`Total Expenses: ₹${normalTotalAmount.toFixed(2)}`, 20, 55)
    
    let yPosition = 75
    settlements.forEach((settlement, index) => {
      doc.text(`${index + 1}. ${settlement.from} pays ₹${settlement.amount.toFixed(2)} to ${settlement.to}`, 20, yPosition)
      yPosition += 15
    })
    doc.save(`${activeTrip}-settlements.pdf`)
  }

  // --- POOL MODE FUNCTIONS ---
  const addPoolTransaction = async (type: 'COLLECTION' | 'EXPENSE') => {
    if (poolDesc.trim() && poolAmount && Number.parseFloat(poolAmount) > 0) {
      await addDoc(collection(db, "trips", activeTrip, "pool_transactions"), {
        description: poolDesc.trim(),
        amountPerPerson: Number.parseFloat(poolAmount),
        type: type,
        createdAt: serverTimestamp()
      });
      setPoolDesc("")
      setPoolAmount("")
    }
  }

  const removePoolTransaction = async (id: string) => {
    await deleteDoc(doc(db, "trips", activeTrip, "pool_transactions", id));
  }

  const totalCollectedPerPerson = poolTransactions.filter(t => t.type === 'COLLECTION').reduce((sum, t) => sum + t.amountPerPerson, 0)
  const totalSpentPerPerson = poolTransactions.filter(t => t.type === 'EXPENSE').reduce((sum, t) => sum + t.amountPerPerson, 0)
  const remainingBalancePerPerson = totalCollectedPerPerson - totalSpentPerPerson

  const generatePoolPDF = () => {
    const doc = new jsPDF()
    doc.setFontSize(20)
    doc.setFont("helvetica", "bold")
    doc.text(`TripSplit - Pooled Ledger: ${activeTrip}`, 20, 30)
    
    doc.setFontSize(12)
    doc.setFont("helvetica", "normal")
    doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 20, 45)
    
    doc.setFont("helvetica", "bold")
    doc.text(`Total Collected Per Person: ₹${totalCollectedPerPerson.toFixed(2)}`, 20, 60)
    doc.text(`Total Spent Per Person: ₹${totalSpentPerPerson.toFixed(2)}`, 20, 70)
    doc.text(`Remaining Balance Per Person: ₹${remainingBalancePerPerson.toFixed(2)}`, 20, 80)

    doc.text("--- Transaction History ---", 20, 100)
    
    doc.setFont("helvetica", "normal")
    let yPosition = 115
    poolTransactions.forEach((tx) => {
      const dateStr = tx.createdAt ? new Date(tx.createdAt.toDate()).toLocaleDateString() : "Just now"
      const typeStr = tx.type === 'COLLECTION' ? '(+) Added to Pool' : '(-) Spent'
      doc.text(`[${dateStr}] ${tx.description}: ₹${tx.amountPerPerson.toFixed(2)} ${typeStr}`, 20, yPosition)
      yPosition += 12
      if (yPosition > 270) {
        doc.addPage()
        yPosition = 30
      }
    })
    
    doc.save(`${activeTrip}-pool-report.pdf`)
  }


  // --- RENDER SCREENS ---

  if (!activeTrip) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col items-center justify-center p-4 gap-4">
        <InstallButton />
        
        <Card className="w-full max-w-md shadow-xl border-t-4 border-t-blue-600">
          <CardHeader className="text-center space-y-2">
            <div className="mx-auto bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mb-2">
              <Receipt className="h-8 w-8 text-blue-600" />
            </div>
            <CardTitle className="text-3xl font-bold text-gray-900">TripSplit</CardTitle>
            <CardDescription className="text-base">Enter a Trip Code to join your friends live.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Trip Code (e.g. GOA-2026)</label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input 
                    placeholder="Enter code" 
                    className="pl-9 uppercase"
                    value={tripCode}
                    onChange={(e) => setTripCode(e.target.value.toUpperCase())}
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-1 gap-3 pt-2">
                <Button onClick={() => joinTrip('normal')} className="w-full text-md h-12 bg-blue-600 hover:bg-blue-700" disabled={tripCode.trim().length < 3}>
                  <Users className="mr-2 h-5 w-5" /> Join Normal Expense
                </Button>
                <Button onClick={() => joinTrip('pool')} className="w-full text-md h-12 bg-indigo-600 hover:bg-indigo-700" disabled={tripCode.trim().length < 3}>
                  <Wallet className="mr-2 h-5 w-5" /> Join Whole Expense (Pool)
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* Universal Header */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${tripMode === 'pool' ? 'bg-indigo-100' : 'bg-blue-100'}`}>
              {tripMode === 'pool' ? <Wallet className="h-6 w-6 text-indigo-600" /> : <Receipt className="h-6 w-6 text-blue-600" />}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 leading-none">TripSplit <span className="text-sm font-normal text-gray-500">({tripMode === 'pool' ? 'Pooled Mode' : 'Normal Mode'})</span></h1>
              <span className="text-sm text-gray-500 font-medium tracking-wide">ROOM: <Badge variant="secondary" className="bg-slate-100 text-slate-700">{activeTrip}</Badge></span>
            </div>
          </div>
          <Button variant="ghost" onClick={leaveTrip} className="text-red-600 hover:text-red-700 hover:bg-red-50">
            <LogOut className="h-4 w-4 mr-2" />
            Leave Trip
          </Button>
        </div>

        {/* --- POOLED MODE DASHBOARD --- */}
        {tripMode === 'pool' && (
          <div className="space-y-6 animate-in fade-in duration-500">
            {/* Top Balances */}
            <div className="grid grid-cols-3 gap-4">
              <Card className="bg-green-50 border-green-100 shadow-sm">
                <CardContent className="p-4 text-center">
                  <div className="text-xs text-green-600 font-bold uppercase tracking-wider mb-1">Collected</div>
                  <div className="text-2xl font-black text-green-700">₹{totalCollectedPerPerson.toFixed(2)}</div>
                  <div className="text-xs text-green-600 mt-1">per person</div>
                </CardContent>
              </Card>
              <Card className="bg-red-50 border-red-100 shadow-sm">
                <CardContent className="p-4 text-center">
                  <div className="text-xs text-red-600 font-bold uppercase tracking-wider mb-1">Spent</div>
                  <div className="text-2xl font-black text-red-700">₹{totalSpentPerPerson.toFixed(2)}</div>
                  <div className="text-xs text-red-600 mt-1">per person</div>
                </CardContent>
              </Card>
              <Card className={`${remainingBalancePerPerson >= 0 ? 'bg-indigo-50 border-indigo-100' : 'bg-orange-50 border-orange-100'} shadow-sm`}>
                <CardContent className="p-4 text-center">
                  <div className={`text-xs ${remainingBalancePerPerson >= 0 ? 'text-indigo-600' : 'text-orange-600'} font-bold uppercase tracking-wider mb-1`}>Remaining</div>
                  <div className={`text-2xl font-black ${remainingBalancePerPerson >= 0 ? 'text-indigo-700' : 'text-orange-700'}`}>₹{remainingBalancePerPerson.toFixed(2)}</div>
                  <div className={`text-xs ${remainingBalancePerPerson >= 0 ? 'text-indigo-600' : 'text-orange-600'} mt-1`}>per person</div>
                </CardContent>
              </Card>
            </div>

            {/* Input Form */}
            <Card className="shadow-md">
              <CardContent className="p-6">
                <div className="flex flex-col md:flex-row gap-4 items-end">
                  <div className="flex-1 w-full">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                    <Input placeholder="e.g. Hotel Booking, Initial Collection" value={poolDesc} onChange={(e) => setPoolDesc(e.target.value)} />
                  </div>
                  <div className="w-full md:w-48">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Amount Per Person</label>
                    <Input type="number" placeholder="₹" value={poolAmount} onChange={(e) => setPoolAmount(e.target.value)} />
                  </div>
                  <div className="flex gap-2 w-full md:w-auto">
                    <Button onClick={() => addPoolTransaction('COLLECTION')} disabled={!poolDesc || !poolAmount} className="flex-1 bg-green-600 hover:bg-green-700">
                      <ArrowDownCircle className="h-4 w-4 mr-1" /> Add Funds
                    </Button>
                    <Button onClick={() => addPoolTransaction('EXPENSE')} disabled={!poolDesc || !poolAmount} className="flex-1 bg-red-600 hover:bg-red-700">
                      <ArrowUpCircle className="h-4 w-4 mr-1" /> Spend
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Ledger Feed */}
            <Card className="shadow-md">
              <CardHeader className="flex flex-row items-center justify-between pb-3 border-b">
                <CardTitle className="text-lg">Ledger History</CardTitle>
                <Button variant="outline" size="sm" onClick={generatePoolPDF} disabled={poolTransactions.length === 0}>
                  Download PDF
                </Button>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="space-y-3 max-h-80 overflow-y-auto pr-2">
                  {poolTransactions.length === 0 ? (
                    <div className="text-center text-gray-500 py-8">No transactions yet. Start by adding funds!</div>
                  ) : (
                    poolTransactions.map((tx) => (
                      <div key={tx.id} className="flex items-center justify-between p-3 bg-white border border-gray-100 shadow-sm rounded-lg">
                        <div>
                          <div className="font-semibold text-gray-900">{tx.description}</div>
                          <div className="text-xs text-gray-500">{tx.createdAt?.toDate().toLocaleDateString() || 'Just now'}</div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className={`font-black text-lg ${tx.type === 'COLLECTION' ? 'text-green-600' : 'text-red-600'}`}>
                            {tx.type === 'COLLECTION' ? '+' : '-'} ₹{tx.amountPerPerson.toFixed(2)}
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => removePoolTransaction(tx.id)} className="text-gray-400 hover:text-red-600 p-0 h-8 w-8">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* --- NORMAL MODE DASHBOARD (Your existing code) --- */}
        {tripMode === 'normal' && (
          <div className="space-y-6 animate-in fade-in duration-500">
            <Card className="shadow-md">
              <CardContent className="p-6">
                <div className="flex flex-col md:flex-row gap-4 items-end">
                  <div className="flex-1 w-full">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Person Name</label>
                    <Input placeholder="Enter name" value={currentName} onChange={(e) => setCurrentName(e.target.value)} />
                  </div>
                  <div className="flex-1 w-full">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Amount Paid (₹)</label>
                    <Input type="number" placeholder="Enter amount" value={currentAmount} onChange={(e) => setCurrentAmount(e.target.value)} />
                  </div>
                  <Button onClick={addNormalExpense} disabled={!currentName.trim() || !currentAmount} className="w-full md:w-auto bg-blue-600 hover:bg-blue-700">
                    <Plus className="h-4 w-4 mr-2" /> Add
                  </Button>
                </div>
              </CardContent>
            </Card>

            {expenses.length > 0 && (
              <Card className="shadow-md">
                <CardHeader className="pb-3 border-b">
                  <CardTitle className="text-lg">Live Feed ({expenses.length})</CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                    {expenses.map((expense) => (
                      <div key={expense.id} className="flex items-center justify-between p-3 bg-gray-50 border border-gray-100 rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className="font-semibold text-gray-900">{expense.name}</div>
                          <div className="text-gray-600">paid <span className="font-medium text-gray-900">₹{expense.amount.toFixed(2)}</span></div>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => removeNormalExpense(expense.id)} className="text-gray-400 hover:text-red-600">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {personTotals.length > 0 && (
              <Card className="shadow-md border-t-4 border-t-blue-500">
                <CardContent className="pt-6">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
                    {personTotals.map((person) => (
                      <div key={person.name} className="p-4 bg-blue-50 border border-blue-100 rounded-xl">
                        <div className="font-semibold text-gray-900">{person.name}</div>
                        <div className="text-xl font-bold text-blue-600">₹{person.total.toFixed(2)}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-6">
                    <Button onClick={() => setCalculated(true)} disabled={personTotals.length < 2} className="w-full text-lg h-12 bg-blue-600 hover:bg-blue-700">
                      <Calculator className="h-5 w-5 mr-2" /> Calculate Settlements
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {calculated && personTotals.length >= 2 && (
              <Card className="shadow-lg border-2 border-yellow-100 animate-in fade-in slide-in-from-bottom-4">
                <CardHeader className="bg-yellow-50/50 rounded-t-xl pb-4 flex flex-row justify-between items-center">
                  <div>
                    <CardTitle className="text-yellow-800">Who Pays Whom</CardTitle>
                    <CardDescription>Settlement Instructions</CardDescription>
                  </div>
                  <Button onClick={generateNormalSettlementPDF} variant="outline" size="sm" className="bg-white">
                    Download PDF
                  </Button>
                </CardHeader>
                <CardContent className="pt-6">
                  <div className="space-y-3">
                    {calculateSettlements().map((settlement, index) => (
                      <div key={index} className="flex items-center justify-between p-4 bg-white border border-yellow-200 shadow-sm rounded-xl">
                        <div className="flex items-center gap-2 md:gap-4 flex-wrap">
                          <div className="font-bold text-lg text-red-600">{settlement.from}</div>
                          <div className="bg-gray-100 px-3 py-1 rounded-full text-sm text-gray-600">pays <ArrowRight className="inline h-3 w-3" /></div>
                          <div className="font-bold text-lg text-green-600">{settlement.to}</div>
                        </div>
                        <div className="font-black text-xl text-gray-900 bg-yellow-100 px-4 py-2 rounded-lg">₹{settlement.amount.toFixed(2)}</div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  )
}