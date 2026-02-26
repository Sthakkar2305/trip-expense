"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Plus, Calculator, Users, ArrowRight, Trash2, Receipt, LogOut, KeyRound } from "lucide-react"
import jsPDF from "jspdf"

// Firebase imports
import { db } from "@/lib/firebase"
import { collection, addDoc, deleteDoc, doc, onSnapshot, query, orderBy, serverTimestamp } from "firebase/firestore"

interface ExpenseEntry {
  id: string
  name: string
  amount: number
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
  const [expenses, setExpenses] = useState<ExpenseEntry[]>([])
  const [currentName, setCurrentName] = useState("")
  const [currentAmount, setCurrentAmount] = useState("")
  const [calculated, setCalculated] = useState(false)

  // Check for saved trip session on load
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedTrip = localStorage.getItem("tripSplit-activeTrip")
      if (savedTrip) setActiveTrip(savedTrip)
    }
  }, [])

  // Firebase Real-time Listener
  useEffect(() => {
    if (!activeTrip) return;

    // Listen to the specific trip's expenses collection
    const q = query(
      collection(db, "trips", activeTrip, "expenses"),
      orderBy("createdAt", "asc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const expenseData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
      })) as ExpenseEntry[];
      
      setExpenses(expenseData);
      // Auto-recalculate if new data comes in while viewing calculations
      if (calculated) setCalculated(false); 
    });

    return () => unsubscribe(); // Cleanup listener when leaving trip
  }, [activeTrip]);

  const joinTrip = (e: React.FormEvent) => {
    e.preventDefault()
    if (tripCode.trim().length >= 3) {
      const normalizedCode = tripCode.trim().toUpperCase()
      setActiveTrip(normalizedCode)
      localStorage.setItem("tripSplit-activeTrip", normalizedCode)
      setTripCode("")
    } else {
      alert("Trip code must be at least 3 characters.")
    }
  }

  const leaveTrip = () => {
    setActiveTrip("")
    setExpenses([])
    setCalculated(false)
    localStorage.removeItem("tripSplit-activeTrip")
  }

  const addExpense = async () => {
    if (currentName.trim() && currentAmount && Number.parseFloat(currentAmount) > 0) {
      try {
        await addDoc(collection(db, "trips", activeTrip, "expenses"), {
          name: currentName.trim(),
          amount: Number.parseFloat(currentAmount),
          createdAt: serverTimestamp()
        });
        setCurrentName("")
        setCurrentAmount("")
        setCalculated(false)
      } catch (error) {
        console.error("Error adding expense:", error)
        alert("Failed to add expense. Check your connection.")
      }
    }
  }

  const removeExpense = async (id: string) => {
    try {
      await deleteDoc(doc(db, "trips", activeTrip, "expenses", id));
      setCalculated(false);
    } catch (error) {
      console.error("Error deleting expense:", error)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      addExpense()
    }
  }

  // Group expenses by person (case-insensitive)
  const getPersonTotals = (): PersonTotal[] => {
    const personMap = new Map<string, number>()
    const originalNames = new Map<string, string>()

    expenses.forEach((expense) => {
      const normalizedName = expense.name.toLowerCase().trim() // Handles SMIT, smit, sMit
      
      // Accumulate totals
      const currentTotal = personMap.get(normalizedName) || 0
      personMap.set(normalizedName, currentTotal + expense.amount)

      // Store the first cased version of the name for display
      if (!originalNames.has(normalizedName)) {
        originalNames.set(normalizedName, expense.name.trim())
      }
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
  const totalAmount = personTotals.reduce((sum, person) => sum + person.total, 0)
  const sharePerPerson = personTotals.length > 0 ? totalAmount / personTotals.length : 0

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
        settlements.push({
          from: debtor.name,
          to: creditor.name,
          amount: Math.round(amount * 100) / 100,
        })
        creditor.balance -= amount
        debtor.balance += amount
      }
      if (Math.abs(creditor.balance) < 0.01) i++
      if (Math.abs(debtor.balance) < 0.01) j++
    }
    return settlements
  }

  const settlements = calculateSettlements()

  // PDF Generation functions (Unchanged)
  const generateFinalBalancePDF = () => {
    const doc = new jsPDF()
    doc.setFontSize(20)
    doc.setFont("helvetica", "bold")
    doc.text(`TripSplit - ${activeTrip} Final Balance`, 20, 30)
    doc.setFontSize(12)
    doc.setFont("helvetica", "normal")
    doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 20, 45)
    doc.text(`Total Expenses: ₹${totalAmount.toFixed(2)}`, 20, 55)
    doc.text(`Per Person Share: ₹${sharePerPerson.toFixed(2)}`, 20, 65)
    doc.text(`Number of People: ${personTotals.length}`, 20, 75)
    doc.setFontSize(14)
    doc.setFont("helvetica", "bold")
    doc.text("Individual Balances:", 20, 95)

    let yPosition = 110
    doc.setFontSize(10)
    doc.setFont("helvetica", "normal")

    personTotals.forEach((person) => {
      doc.text(`${person.name}:`, 25, yPosition)
      doc.text(`Paid: ₹${person.total.toFixed(2)}`, 25, yPosition + 8)
      doc.text(`Should Pay: ₹${person.shouldPay.toFixed(2)}`, 25, yPosition + 16)
      const balanceText = person.balance > 0.01 ? `Owed: ₹${person.balance.toFixed(2)}` : person.balance < -0.01 ? `Owes: ₹${Math.abs(person.balance).toFixed(2)}` : "Settled"
      doc.setFont("helvetica", "bold")
      doc.text(balanceText, 25, yPosition + 24)
      doc.setFont("helvetica", "normal")
      yPosition += 40
      if (yPosition > 250) {
        doc.addPage()
        yPosition = 30
      }
    })
    doc.save(`${activeTrip}-final-balance.pdf`)
  }

  const generateSettlementPDF = () => {
    const doc = new jsPDF()
    doc.setFontSize(20)
    doc.setFont("helvetica", "bold")
    doc.text(`TripSplit - ${activeTrip} Settlements`, 20, 30)
    doc.setFontSize(12)
    doc.setFont("helvetica", "normal")
    doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 20, 45)
    doc.text(`Total Expenses: ₹${totalAmount.toFixed(2)}`, 20, 55)
    doc.text(`Per Person Share: ₹${sharePerPerson.toFixed(2)}`, 20, 65)
    doc.setFontSize(14)
    doc.setFont("helvetica", "bold")
    doc.text("Settlement Instructions:", 20, 85)

    if (settlements.length === 0) {
      doc.setFontSize(12)
      doc.setFont("helvetica", "normal")
      doc.text("All expenses are already settled!", 25, 105)
    } else {
      let yPosition = 105
      doc.setFontSize(12)
      doc.setFont("helvetica", "normal")
      settlements.forEach((settlement, index) => {
        doc.text(`${index + 1}. ${settlement.from} pays ₹${settlement.amount.toFixed(2)} to ${settlement.to}`, 25, yPosition)
        yPosition += 15
        if (yPosition > 250) {
          doc.addPage()
          yPosition = 30
        }
      })
      yPosition += 10
      doc.setFont("helvetica", "bold")
      doc.text("Summary:", 20, yPosition)
      doc.setFont("helvetica", "normal")
      yPosition += 15
      doc.text(`Total number of transactions needed: ${settlements.length}`, 25, yPosition)
      yPosition += 10
      const totalSettlementAmount = settlements.reduce((sum, s) => sum + s.amount, 0)
      doc.text(`Total amount to be transferred: ₹${totalSettlementAmount.toFixed(2)}`, 25, yPosition)
    }
    doc.save(`${activeTrip}-settlements.pdf`)
  }

  // Render Login/Join Screen if no active trip
  if (!activeTrip) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-xl border-t-4 border-t-blue-600">
          <CardHeader className="text-center space-y-2">
            <div className="mx-auto bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mb-2">
              <Receipt className="h-8 w-8 text-blue-600" />
            </div>
            <CardTitle className="text-3xl font-bold text-gray-900">TripSplit</CardTitle>
            <CardDescription className="text-base">Enter a Trip Code to join your friends live.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={joinTrip} className="space-y-4">
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
              <Button type="submit" className="w-full text-lg h-12" disabled={tripCode.trim().length < 3}>
                Join Trip <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Main Dashboard
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* Header with Leave Trip Button */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="bg-blue-100 p-2 rounded-lg">
              <Receipt className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 leading-none">TripSplit</h1>
              <span className="text-sm text-gray-500 font-medium tracking-wide">ROOM: <Badge variant="secondary" className="bg-blue-50 text-blue-700">{activeTrip}</Badge></span>
            </div>
          </div>
          <Button variant="ghost" onClick={leaveTrip} className="text-red-600 hover:text-red-700 hover:bg-red-50">
            <LogOut className="h-4 w-4 mr-2" />
            Leave Trip
          </Button>
        </div>

        {/* Add Expense Form */}
        <Card className="shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-blue-600" />
              Add Expense
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col md:flex-row gap-4 items-end">
              <div className="flex-1 w-full">
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">Person Name</label>
                <Input
                  id="name"
                  placeholder="Enter name (e.g. Smit)"
                  value={currentName}
                  onChange={(e) => setCurrentName(e.target.value)}
                  onKeyPress={handleKeyPress}
                />
              </div>
              <div className="flex-1 w-full">
                <label htmlFor="amount" className="block text-sm font-medium text-gray-700 mb-1">Amount Paid (₹)</label>
                <Input
                  id="amount"
                  type="number"
                  placeholder="Enter amount"
                  value={currentAmount}
                  onChange={(e) => setCurrentAmount(e.target.value)}
                  onKeyPress={handleKeyPress}
                  min="0"
                  step="0.01"
                />
              </div>
              <Button onClick={addExpense} disabled={!currentName.trim() || !currentAmount || Number.parseFloat(currentAmount) <= 0} className="w-full md:w-auto">
                <Plus className="h-4 w-4 mr-2" />
                Add
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Expense Entries */}
        {expenses.length > 0 && (
          <Card className="shadow-md">
            <CardHeader className="pb-3 border-b">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Receipt className="h-5 w-5 text-gray-500" />
                Live Feed ({expenses.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                {expenses.map((expense) => (
                  <div key={expense.id} className="flex items-center justify-between p-3 bg-gray-50 border border-gray-100 rounded-lg hover:bg-gray-100 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="font-semibold text-gray-900">{expense.name}</div>
                      <div className="text-gray-600">paid <span className="font-medium text-gray-900">₹{expense.amount.toFixed(2)}</span></div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => removeExpense(expense.id)} className="text-gray-400 hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Live Summary */}
        {personTotals.length > 0 && (
          <Card className="shadow-md border-t-4 border-t-indigo-500">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-indigo-500" />
                Live Summary
              </CardTitle>
              <CardDescription>Running totals per person (synced for everyone in {activeTrip})</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
                {personTotals.map((person) => (
                  <div key={person.name} className="p-4 bg-indigo-50/50 border border-indigo-100 rounded-xl text-center md:text-left">
                    <div className="font-semibold text-gray-900 truncate">{person.name}</div>
                    <div className="text-xl md:text-2xl font-bold text-indigo-600">₹{person.total.toFixed(2)}</div>
                    <div className="text-xs text-gray-500 uppercase tracking-wider mt-1">Total paid</div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-4 pt-6 border-t border-gray-100">
                <div className="text-center">
                  <div className="text-sm text-gray-500 font-medium uppercase tracking-wider mb-1">Total Trip Cost</div>
                  <div className="text-3xl font-bold text-gray-900">₹{totalAmount.toFixed(2)}</div>
                </div>
                <div className="text-center border-l border-gray-100">
                  <div className="text-sm text-gray-500 font-medium uppercase tracking-wider mb-1">Cost Per Person</div>
                  <div className="text-3xl font-bold text-gray-900">₹{sharePerPerson.toFixed(2)}</div>
                </div>
              </div>

              <div className="mt-8">
                <Button onClick={() => setCalculated(true)} disabled={personTotals.length < 2} className="w-full text-lg h-12 bg-indigo-600 hover:bg-indigo-700">
                  <Calculator className="h-5 w-5 mr-2" />
                  Calculate Final Split
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Final Settlement */}
        {calculated && personTotals.length >= 2 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Individual Balances */}
            <Card className="shadow-lg border-2 border-green-100">
              <CardHeader className="bg-green-50/50 rounded-t-xl pb-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <CardTitle className="text-green-800">Final Balances</CardTitle>
                    <CardDescription>How much each person paid vs their fair share</CardDescription>
                  </div>
                  <Button onClick={generateFinalBalancePDF} variant="outline" size="sm" className="bg-white">
                    <Receipt className="h-4 w-4 mr-2" />
                    Download PDF
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="space-y-3">
                  {personTotals.map((person) => (
                    <div key={person.name} className="flex flex-col md:flex-row md:items-center justify-between p-4 border rounded-xl gap-3">
                      <div className="flex-1">
                        <div className="font-bold text-lg text-gray-900">{person.name}</div>
                        <div className="text-sm text-gray-600 flex gap-4 mt-1">
                          <span>Paid: <span className="font-medium text-gray-900">₹{person.total.toFixed(2)}</span></span>
                          <span>Share: <span className="font-medium text-gray-900">₹{person.shouldPay.toFixed(2)}</span></span>
                        </div>
                      </div>
                      <div className="md:text-right">
                        <Badge variant={person.balance > 0.01 ? "default" : person.balance < -0.01 ? "destructive" : "secondary"} className="text-sm px-3 py-1">
                          {person.balance > 0.01 ? `Gets back ₹${person.balance.toFixed(2)}` : person.balance < -0.01 ? `Needs to pay ₹${Math.abs(person.balance).toFixed(2)}` : "All Settled"}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Settlement Instructions */}
            {settlements.length > 0 && (
              <Card className="shadow-lg border-2 border-yellow-100">
                <CardHeader className="bg-yellow-50/50 rounded-t-xl pb-4">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <CardTitle className="text-yellow-800">Who Pays Whom</CardTitle>
                      <CardDescription>The easiest way to settle all debts</CardDescription>
                    </div>
                    <Button onClick={generateSettlementPDF} variant="outline" size="sm" className="bg-white">
                      <ArrowRight className="h-4 w-4 mr-2" />
                      Download PDF
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="pt-6">
                  <div className="space-y-3">
                    {settlements.map((settlement, index) => (
                      <div key={index} className="flex items-center justify-between p-4 bg-white border border-yellow-200 shadow-sm rounded-xl">
                        <div className="flex items-center gap-2 md:gap-4 flex-wrap">
                          <div className="font-bold text-lg text-red-600">{settlement.from}</div>
                          <div className="bg-gray-100 px-3 py-1 rounded-full flex items-center gap-2 text-sm text-gray-600">
                            pays <ArrowRight className="h-4 w-4" />
                          </div>
                          <div className="font-bold text-lg text-green-600">{settlement.to}</div>
                        </div>
                        <div className="font-black text-xl text-gray-900 bg-yellow-100 px-4 py-2 rounded-lg">
                          ₹{settlement.amount.toFixed(2)}
                        </div>
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